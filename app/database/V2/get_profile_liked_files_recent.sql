-- Fix profile Liked tab: order by when the user liked (created_at), not like row UUID.
-- UUID DESC is effectively random; recent likes must appear first.
-- Run in Supabase SQL Editor (idempotent).

CREATE INDEX IF NOT EXISTS idx_likes_user_created
  ON public.likes (user_id, created_at DESC);

DROP FUNCTION IF EXISTS get_profile_liked_files(uuid, uuid, int, int);

CREATE OR REPLACE FUNCTION get_profile_liked_files(
  p_profile_user_id uuid,
  p_viewer_id uuid DEFAULT NULL,
  p_limit int DEFAULT 20,
  p_cursor_pos int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  endpoint text,
  filename text,
  unique_id text,
  file_size text,
  file_type text,
  is_adult boolean,
  owner_id uuid,
  is_public boolean,
  file_description text,
  file_title text,
  default_thumbnail text,
  view_count numeric,
  share_count numeric,
  is_reel boolean,
  is_series_main boolean,
  is_files_series_item boolean,
  file_series_id uuid,
  file_series_episode_id uuid,
  duration numeric,
  categories jsonb,
  tags jsonb,
  colors jsonb,
  metadata jsonb,
  like_count bigint,
  dislike_count bigint,
  comment_count bigint,
  engagement_score float,
  feed_pool text,
  owner_username text,
  owner_profile_pic text,
  owner_verified boolean,
  owner_about text,
  user_has_liked boolean,
  user_has_disliked boolean,
  upload_status text,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_owner boolean := (p_viewer_id IS NOT NULL AND p_viewer_id = p_profile_user_id);
BEGIN
  IF NOT v_owner THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH
  base AS (
    SELECT
      f.id AS fid,
      l.created_at AS liked_at,
      f.created_at,
      f.endpoint,
      f.filename,
      f.unique_id,
      f.file_size,
      f.file_type,
      f.is_adult,
      f.owner_id,
      f.is_public,
      f.file_description,
      f.file_title,
      f.default_thumbnail,
      f.view_count,
      f.share_count,
      f.is_reel,
      f.is_series_main,
      f.is_files_series_item,
      f.file_series_id,
      f.file_series_episode_id,
      f.duration,
      f.categories,
      f.tags,
      f.colors,
      f.metadata,
      f.upload_status
    FROM likes l
    JOIN files f ON f.id = l.file_id
    WHERE l.user_id = p_profile_user_id
      AND (f.upload_status = 'complete' OR f.upload_status = 'completed')
  ),
  enriched AS (
    SELECT
      b.*,
      (SELECT COUNT(*)::bigint FROM likes l2 WHERE l2.file_id = b.fid) AS _like_count,
      (SELECT COUNT(*)::bigint FROM dislike d WHERE d.file_id = b.fid) AS _dislike_count,
      (SELECT COUNT(*)::bigint FROM comments c WHERE c.file_id = b.fid AND c.is_deleted = false) AS _comment_count,
      (p_viewer_id IS NOT NULL AND EXISTS (SELECT 1 FROM likes l3 WHERE l3.file_id = b.fid AND l3.user_id = p_viewer_id)) AS _viewer_liked,
      (p_viewer_id IS NOT NULL AND EXISTS (SELECT 1 FROM dislike d2 WHERE d2.file_id = b.fid AND d2.user_id = p_viewer_id)) AS _viewer_disliked
    FROM base b
  ),
  counted AS (
    SELECT COUNT(*)::bigint AS cnt FROM enriched
  ),
  ranked AS (
    SELECT
      e.*,
      ROW_NUMBER() OVER (ORDER BY e.liked_at DESC NULLS LAST, e.fid DESC) AS _rn
    FROM enriched e
  )
  SELECT
    r.fid,
    r.created_at,
    r.endpoint,
    r.filename,
    r.unique_id,
    r.file_size,
    r.file_type,
    r.is_adult,
    r.owner_id,
    r.is_public,
    r.file_description,
    r.file_title,
    r.default_thumbnail,
    r.view_count,
    r.share_count,
    r.is_reel,
    r.is_series_main,
    r.is_files_series_item,
    r.file_series_id,
    r.file_series_episode_id,
    r.duration,
    r.categories,
    r.tags,
    r.colors,
    r.metadata,
    r._like_count,
    r._dislike_count,
    r._comment_count,
    CASE WHEN GREATEST(r.view_count, 1) > 0 THEN
      (r._like_count + r._comment_count + r.share_count)::float
      / GREATEST(r.view_count, 1)::float
    ELSE 0.0 END,
    'profile_liked'::text,
    u.username,
    u.profile_pic,
    u.verified,
    u.about,
    r._viewer_liked,
    r._viewer_disliked,
    r.upload_status,
    c.cnt
  FROM ranked r
  JOIN users u ON u.id = r.owner_id
  CROSS JOIN counted c
  WHERE r._rn > p_cursor_pos
  ORDER BY r._rn ASC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_profile_liked_files(uuid, uuid, int, int) TO anon, authenticated;
