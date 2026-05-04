-- ============================================================
-- FILE VIEW EVENTS v2 — Hardened anti-gaming
-- ============================================================
-- Fixes over v1:
--   1. Advisory lock prevents race condition (two concurrent requests both counting)
--   2. Global per-viewer cap: max 100 counted views per hour across ALL files
--   3. Tighter currentTime validation: can't exceed duration by more than 50%
--   4. Auto-cleanup function for old rows (call on cron)
--   5. Additional index for global viewer cap query
-- ============================================================

-- New index for global per-viewer hourly query
CREATE INDEX IF NOT EXISTS idx_file_view_events_viewer_created
  ON file_view_events (viewer_key, created_at DESC);

-- Drop and recreate the function with hardened logic
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
  v_global_count int;
  v_views bigint;
  v_view_count bigint;
  v_lock_key bigint;
  v_safe_ct real;
  v_safe_dur real;
BEGIN
  -- ── Basic validation ──────────────────────────────────────
  IF p_file_id IS NULL OR p_viewer_key IS NULL OR length(trim(p_viewer_key)) = 0 THEN
    RETURN QUERY SELECT false, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  -- Clamp inputs server-side (defense in depth — API already clamps, but don't trust the caller)
  v_safe_ct := LEAST(86400.0::real, GREATEST(0.0::real, COALESCE(p_current_time_s, 0)));
  v_safe_dur := LEAST(86400.0::real, GREATEST(0.0::real, COALESCE(p_duration_s, 0)));

  -- ── Server-side currentTime vs duration sanity check ──────
  -- A legitimate player can buffer slightly past duration, but not 2x.
  -- If currentTime > duration * 1.5, clamp it down (don't reject, just clamp).
  IF v_safe_dur > 0 AND v_safe_ct > v_safe_dur * 1.5 THEN
    v_safe_ct := v_safe_dur;
  END IF;

  -- ── Require "real" progress based on media type ───────────
  IF p_file_type LIKE 'video/%' OR p_file_type LIKE 'audio/%' OR p_file_type = 'application/vnd.apple.mpegurl' THEN
    IF v_safe_dur <= 0 THEN
      v_required_s := 10;
    ELSE
      v_required_s := LEAST(30, GREATEST(5, (v_safe_dur * 0.10)));
    END IF;
  ELSE
    v_required_s := 2;
  END IF;

  IF v_safe_ct < v_required_s THEN
    SELECT COALESCE(f.views, 0), COALESCE(f.view_count, 0) INTO v_views, v_view_count
    FROM files f WHERE f.id = p_file_id;
    RETURN QUERY SELECT false, COALESCE(v_views, 0), COALESCE(v_view_count, 0);
    RETURN;
  END IF;

  -- ── Advisory lock: prevent race condition on same viewer+file ──
  -- hashtext returns int4; combine file+viewer into a single lock key.
  v_lock_key := (hashtext(p_file_id::text || '::' || p_viewer_key))::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- ── Per-file per-viewer cap: 3 per hour ───────────────────
  SELECT COUNT(*) INTO v_recent_count
  FROM file_view_events e
  WHERE e.file_id = p_file_id
    AND e.viewer_key = p_viewer_key
    AND e.created_at >= v_window_start;

  IF v_recent_count >= 3 THEN
    SELECT COALESCE(f.views, 0), COALESCE(f.view_count, 0) INTO v_views, v_view_count
    FROM files f WHERE f.id = p_file_id;
    RETURN QUERY SELECT false, COALESCE(v_views, 0), COALESCE(v_view_count, 0);
    RETURN;
  END IF;

  -- ── Global per-viewer cap: 100 views per hour across ALL files ──
  -- Prevents a bot from inflating views on thousands of files simultaneously.
  SELECT COUNT(*) INTO v_global_count
  FROM file_view_events e
  WHERE e.viewer_key = p_viewer_key
    AND e.created_at >= v_window_start;

  IF v_global_count >= 100 THEN
    SELECT COALESCE(f.views, 0), COALESCE(f.view_count, 0) INTO v_views, v_view_count
    FROM files f WHERE f.id = p_file_id;
    RETURN QUERY SELECT false, COALESCE(v_views, 0), COALESCE(v_view_count, 0);
    RETURN;
  END IF;

  -- ── All checks passed — record the view ───────────────────
  INSERT INTO file_view_events (file_id, user_id, viewer_key, created_at)
  VALUES (p_file_id, p_user_id, p_viewer_key, v_now);

  UPDATE files f
  SET
    views = COALESCE(f.views, 0) + 1,
    view_count = COALESCE(f.view_count, 0) + 1
  WHERE f.id = p_file_id
  RETURNING COALESCE(f.views, 0), COALESCE(f.view_count, 0)
  INTO v_views, v_view_count;

  RETURN QUERY SELECT true, COALESCE(v_views, 0), COALESCE(v_view_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION increment_file_view_if_eligible(uuid, uuid, text, real, real, text) TO anon, authenticated;


-- ============================================================
-- AUTO-CLEANUP: Delete view events older than 7 days
-- Call on a cron (e.g. daily): SELECT cleanup_old_view_events();
-- We only need the last hour for rate limiting; keep 7 days for analytics.
-- ============================================================
CREATE OR REPLACE FUNCTION cleanup_old_view_events()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted bigint;
BEGIN
  DELETE FROM file_view_events
  WHERE created_at < now() - interval '7 days';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION cleanup_old_view_events() TO authenticated;
