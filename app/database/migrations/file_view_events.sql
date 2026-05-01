-- Persistent view anti-farm protection.
-- Goal:
-- - Only count a view once the client reports real playback/dwell progress.
-- - Limit: max 3 counted views per viewer per file per 1 hour.
-- - Viewer identity: authenticated user_id OR fallback viewer_key derived from IP + UA.

CREATE TABLE IF NOT EXISTS file_view_events (
  id bigserial PRIMARY KEY,
  file_id uuid NOT NULL REFERENCES files (id) ON DELETE CASCADE,
  user_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  viewer_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_file_view_events_file_viewer_created
  ON file_view_events (file_id, viewer_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_file_view_events_user_file_created
  ON file_view_events (user_id, file_id, created_at DESC);

ALTER TABLE file_view_events ENABLE ROW LEVEL SECURITY;

-- Server-only RPC to atomically record + increment.
DROP FUNCTION IF EXISTS increment_file_view_if_eligible(uuid, uuid, text, real, real, text);
CREATE OR REPLACE FUNCTION increment_file_view_if_eligible(
  p_file_id uuid,
  p_user_id uuid,
  p_viewer_key text,
  p_current_time_s real,
  p_duration_s real,
  p_file_type text
)
RETURNS TABLE (
  counted boolean,
  views bigint,
  view_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_window_start timestamptz := v_now - interval '1 hour';
  v_required_s real;
  v_recent_count int;
  v_views bigint;
  v_view_count bigint;
BEGIN
  IF p_file_id IS NULL OR p_viewer_key IS NULL OR length(trim(p_viewer_key)) = 0 THEN
    RETURN QUERY SELECT false, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  -- Require "real" progress based on media type.
  -- Videos/audio: require min(30s, max(5s, 10% of duration)).
  -- Images/other: require at least ~2 seconds dwell (client reports current_time_s as dwell seconds).
  IF p_file_type LIKE 'video/%' OR p_file_type LIKE 'audio/%' OR p_file_type = 'application/vnd.apple.mpegurl' THEN
    IF p_duration_s IS NULL OR p_duration_s <= 0 THEN
      v_required_s := 10;
    ELSE
      v_required_s := LEAST(30, GREATEST(5, (p_duration_s * 0.10)));
    END IF;
  ELSE
    v_required_s := 2;
  END IF;

  IF COALESCE(p_current_time_s, 0) < v_required_s THEN
    SELECT COALESCE(f.views, 0), COALESCE(f.view_count, 0) INTO v_views, v_view_count
    FROM files f
    WHERE f.id = p_file_id;
    RETURN QUERY SELECT false, COALESCE(v_views, 0), COALESCE(v_view_count, 0);
    RETURN;
  END IF;

  -- 3 per hour per viewer_key per file.
  SELECT COUNT(*) INTO v_recent_count
  FROM file_view_events e
  WHERE e.file_id = p_file_id
    AND e.viewer_key = p_viewer_key
    AND e.created_at >= v_window_start;

  IF v_recent_count >= 3 THEN
    SELECT COALESCE(f.views, 0), COALESCE(f.view_count, 0) INTO v_views, v_view_count
    FROM files f
    WHERE f.id = p_file_id;
    RETURN QUERY SELECT false, COALESCE(v_views, 0), COALESCE(v_view_count, 0);
    RETURN;
  END IF;

  INSERT INTO file_view_events (file_id, user_id, viewer_key, created_at)
  VALUES (p_file_id, p_user_id, p_viewer_key, v_now);

  UPDATE files
  SET
    views = COALESCE(files.views, 0) + 1,
    view_count = COALESCE(files.view_count, 0) + 1
  WHERE id = p_file_id
  RETURNING COALESCE(files.views, 0), COALESCE(files.view_count, 0)
  INTO v_views, v_view_count;

  RETURN QUERY SELECT true, COALESCE(v_views, 0), COALESCE(v_view_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION increment_file_view_if_eligible(uuid, uuid, text, real, real, text) TO anon, authenticated;

