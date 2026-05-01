-- Per-user, per-file playback position. One row per (user_id, file_id); upserts on save.
-- Read by video card grids (bulk) and by the series-resume RPC for one-click "continue watching".

CREATE TABLE IF NOT EXISTS user_watch_progress (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES files (id) ON DELETE CASCADE,
  current_time_s real NOT NULL DEFAULT 0,
  duration_s real NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, file_id)
);

CREATE INDEX IF NOT EXISTS idx_user_watch_progress_user_updated
  ON user_watch_progress (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_watch_progress_file
  ON user_watch_progress (file_id);

ALTER TABLE user_watch_progress ENABLE ROW LEVEL SECURITY;

-- Single-row upsert. Server passes p_user_id from verified session only.
DROP FUNCTION IF EXISTS upsert_user_watch_progress(uuid, uuid, real, real);
CREATE OR REPLACE FUNCTION upsert_user_watch_progress(
  p_user_id uuid,
  p_file_id uuid,
  p_current_time real,
  p_duration real
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO user_watch_progress (user_id, file_id, current_time_s, duration_s, updated_at)
  VALUES (
    p_user_id,
    p_file_id,
    GREATEST(0, COALESCE(p_current_time, 0)),
    GREATEST(0, COALESCE(p_duration, 0)),
    now()
  )
  ON CONFLICT (user_id, file_id) DO UPDATE
  SET
    current_time_s = EXCLUDED.current_time_s,
    duration_s = CASE
      WHEN EXCLUDED.duration_s > 0 THEN EXCLUDED.duration_s
      ELSE user_watch_progress.duration_s
    END,
    updated_at = EXCLUDED.updated_at;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_user_watch_progress(uuid, uuid, real, real) TO anon, authenticated;

-- Bulk read for video card grids: returns one row per file_id present for this user.
DROP FUNCTION IF EXISTS get_user_watch_progress(uuid, uuid[]);
CREATE OR REPLACE FUNCTION get_user_watch_progress(
  p_user_id uuid,
  p_file_ids uuid[]
)
RETURNS TABLE (
  file_id uuid,
  current_time_s real,
  duration_s real,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL OR p_file_ids IS NULL OR array_length(p_file_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.file_id,
    p.current_time_s,
    p.duration_s,
    p.updated_at
  FROM user_watch_progress p
  WHERE p.user_id = p_user_id
    AND p.file_id = ANY(p_file_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_watch_progress(uuid, uuid[]) TO anon, authenticated;

-- Series resume: most recently watched file in this series for this user.
-- Falls back to NULL when the user has never opened any episode (caller routes to series main).
DROP FUNCTION IF EXISTS get_series_resume(uuid, uuid);
CREATE OR REPLACE FUNCTION get_series_resume(
  p_user_id uuid,
  p_file_series_id uuid
)
RETURNS TABLE (
  file_id uuid,
  unique_id text,
  current_time_s real,
  duration_s real,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL OR p_file_series_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    f.id AS file_id,
    f.unique_id,
    p.current_time_s,
    p.duration_s,
    p.updated_at
  FROM user_watch_progress p
  JOIN files f ON f.id = p.file_id
  WHERE p.user_id = p_user_id
    AND f.file_series_id = p_file_series_id
    AND (f.upload_status = 'complete' OR f.upload_status = 'completed')
  ORDER BY p.updated_at DESC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION get_series_resume(uuid, uuid) TO anon, authenticated;
