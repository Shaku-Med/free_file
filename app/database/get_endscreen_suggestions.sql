-- ============================================================
-- get_endscreen_suggestions — Up next / end screen suggestions
-- ============================================================
-- Convenience wrapper around get_related for "Up next" / end screen.
-- Returns the first page of related items (default 8).
-- Use this from your app or from get_related with p_limit=8.
-- Requires get_related to exist (run get_related.sql first).
-- ============================================================

CREATE OR REPLACE FUNCTION get_endscreen_suggestions(
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
  thumbnails       jsonb[],
  view_count       numeric,
  share_count      numeric,
  is_reel          boolean,
  duration         numeric,
  categories       jsonb,
  tags             jsonb,
  colors           jsonb,
  metadata         jsonb,
  like_count       bigint,
  dislike_count    bigint,
  comment_count    bigint,
  engagement_score float,
  feed_pool        text,
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

GRANT EXECUTE ON FUNCTION get_endscreen_suggestions TO anon, authenticated;
