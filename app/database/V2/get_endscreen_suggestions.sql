-- ============================================================
-- get_endscreen_suggestions  Up next / end screen suggestions
-- ============================================================
-- Convenience wrapper around get_related for "Up next" / end screen.
-- Returns the first page of related items (default 8).
-- Use this from your app or from get_related with p_limit=8.
-- Requires get_related v4 to exist (run get_related_v4.sql first).
--
-- NOTE: the RETURNS TABLE column list MUST stay in lockstep with
-- get_related's return columns  `SELECT *` here errors at runtime
-- ("structure of query does not match function result type") the
-- moment they drift. Last synced with get_related_v4.sql.
-- ============================================================

-- Drop every overload (old return types can't be replaced in-place).
DO $drop_endscreen$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch, p.proname AS nm, p.oid AS oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'get_endscreen_suggestions'
      AND n.nspname = 'public'
  LOOP
    EXECUTE format(
      'DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE',
      r.sch,
      r.nm,
      pg_get_function_identity_arguments(r.oid)
    );
  END LOOP;
END;
$drop_endscreen$;

CREATE OR REPLACE FUNCTION public.get_endscreen_suggestions(
  p_file_id uuid,
  p_user_id uuid DEFAULT NULL,
  p_limit   int  DEFAULT 8
)
RETURNS TABLE (
  id               uuid,
  created_at       timestamptz,
  endpoint         text,
  filename         text,
  unique_id        text,
  file_size        text,
  file_type        text,
  is_adult         boolean,
  owner_id         uuid,
  is_public        boolean,
  file_description text,
  file_title       text,
  default_thumbnail text,
  view_count       numeric,
  share_count      numeric,
  is_reel          boolean,
  is_series_main   boolean,
  is_files_series_item boolean,
  file_series_id   uuid,
  file_series_episode_id uuid,
  duration         numeric,
  categories       jsonb,
  tags             jsonb,
  colors           jsonb,
  metadata         jsonb,
  captions         jsonb,
  like_count       bigint,
  dislike_count    bigint,
  comment_count    bigint,
  engagement_score float,
  feed_pool        text,
  feed_reel_cluster_id bigint,
  owner_username    text,
  owner_profile_pic text,
  owner_verified    boolean,
  owner_about       text,
  user_has_liked    boolean,
  user_has_disliked boolean
)
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM get_related(
    p_file_id,
    p_user_id,
    GREATEST(1, LEAST(p_limit, 20)),
    0,
    '{}'::uuid[]
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_endscreen_suggestions(uuid, uuid, int) TO anon, authenticated;
