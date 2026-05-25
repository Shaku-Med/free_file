-- ============================================================
-- file_engagement_stats  keep counts in sync with likes/dislike/comments
-- ============================================================
-- The materialized view does NOT auto-update. When users like,
-- dislike, or comment, the underlying tables change but the view
-- stays stale until refreshed. Feed, related videos, and search
-- read from this view, so run a refresh periodically or after writes.
-- ============================================================

-- 1. Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY
--    (so reads can continue while refreshing). Run once after creating the view.
CREATE UNIQUE INDEX IF NOT EXISTS file_engagement_stats_file_id_key
  ON public.file_engagement_stats (file_id);

-- 2. Refresh function (use in cron or call after bulk updates)
CREATE OR REPLACE FUNCTION refresh_file_engagement_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.file_engagement_stats;
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_file_engagement_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_file_engagement_stats() TO service_role;

-- ============================================================
-- Option A: Refresh on a schedule (recommended)
-- ============================================================
-- In Supabase: Dashboard → Database → Extensions → enable pg_cron (if available),
-- then add a cron job to run every 1–5 minutes, e.g.:
--
--   SELECT cron.schedule(
--     'refresh-file-engagement',
--     '*/2 * * * *',  -- every 2 minutes
--     $$SELECT refresh_file_engagement_stats()$$
--   );
--
-- Or use an external cron / Supabase Edge Function to call:
--   supabase.rpc('refresh_file_engagement_stats')

-- ============================================================
-- Option B: Refresh after every like/dislike/comment (optional)
-- ============================================================
-- Uncomment below to refresh the view on every insert/delete to
-- likes, dislike, or comments. Simpler but heavier under load.
-- ============================================================

-- CREATE OR REPLACE FUNCTION trigger_refresh_file_engagement_stats()
-- RETURNS trigger
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public
-- AS $$
-- BEGIN
--   REFRESH MATERIALIZED VIEW CONCURRENTLY public.file_engagement_stats;
--   RETURN NULL;
-- END;
-- $$;

-- DROP TRIGGER IF EXISTS trg_likes_refresh_engagement ON likes;
-- CREATE TRIGGER trg_likes_refresh_engagement
--   AFTER INSERT OR DELETE ON likes
--   FOR EACH STATEMENT EXECUTE FUNCTION trigger_refresh_file_engagement_stats();

-- DROP TRIGGER IF EXISTS trg_dislike_refresh_engagement ON dislike;
-- CREATE TRIGGER trg_dislike_refresh_engagement
--   AFTER INSERT OR DELETE ON dislike
--   FOR EACH STATEMENT EXECUTE FUNCTION trigger_refresh_file_engagement_stats();

-- DROP TRIGGER IF EXISTS trg_comments_refresh_engagement ON comments;
-- CREATE TRIGGER trg_comments_refresh_engagement
--   AFTER INSERT OR DELETE ON comments
--   FOR EACH STATEMENT EXECUTE FUNCTION trigger_refresh_file_engagement_stats();
