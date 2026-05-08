-- ============================================================
-- Denormalized file_count on users — kills the N+1 in search
-- ============================================================
-- Before: every user search ran one COUNT(*) query per matched
-- user. With 10 matches that's 11 queries per request.
-- After: file_count is read from the users row, no extra hop.
-- Maintained by trigger on the files table for the conditions
-- the UI cares about (public + non-adult + complete uploads).
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS file_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_users_file_count ON users (file_count DESC);

-- Backfill once. Counts only files the search UI would actually surface.
UPDATE users u
SET file_count = sub.cnt
FROM (
  SELECT owner_id, COUNT(*)::int AS cnt
  FROM files
  WHERE is_public = true AND is_adult = false AND upload_status = 'complete'
  GROUP BY owner_id
) sub
WHERE u.id = sub.owner_id;

-- Trigger function. Adjusts file_count for the affected owner(s) based
-- on whether the row counts as "visible" before vs after the change.
CREATE OR REPLACE FUNCTION sync_user_file_count()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  old_visible boolean;
  new_visible boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_public = true AND NEW.is_adult = false AND NEW.upload_status = 'complete' THEN
      UPDATE users SET file_count = file_count + 1 WHERE id = NEW.owner_id;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.is_public = true AND OLD.is_adult = false AND OLD.upload_status = 'complete' THEN
      UPDATE users SET file_count = GREATEST(file_count - 1, 0) WHERE id = OLD.owner_id;
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: handle visibility flips and owner reassignments.
  old_visible := OLD.is_public = true AND OLD.is_adult = false AND OLD.upload_status = 'complete';
  new_visible := NEW.is_public = true AND NEW.is_adult = false AND NEW.upload_status = 'complete';

  IF OLD.owner_id = NEW.owner_id THEN
    IF old_visible AND NOT new_visible THEN
      UPDATE users SET file_count = GREATEST(file_count - 1, 0) WHERE id = OLD.owner_id;
    ELSIF NOT old_visible AND new_visible THEN
      UPDATE users SET file_count = file_count + 1 WHERE id = NEW.owner_id;
    END IF;
  ELSE
    -- Ownership transfer (rare). Decrement old, increment new.
    IF old_visible THEN
      UPDATE users SET file_count = GREATEST(file_count - 1, 0) WHERE id = OLD.owner_id;
    END IF;
    IF new_visible THEN
      UPDATE users SET file_count = file_count + 1 WHERE id = NEW.owner_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_user_file_count ON files;
CREATE TRIGGER trg_sync_user_file_count
AFTER INSERT OR UPDATE OR DELETE ON files
FOR EACH ROW EXECUTE FUNCTION sync_user_file_count();
