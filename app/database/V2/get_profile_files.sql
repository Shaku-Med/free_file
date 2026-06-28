-- ============================================================
-- PROFILE FILES  paginated file listing for user profiles
-- Counts directly via subqueries (not materialized view)
-- Adult content only visible to the profile owner
-- ============================================================

DROP FUNCTION IF EXISTS get_profile_files(uuid, uuid, int, int);
DROP FUNCTION IF EXISTS get_profile_files(uuid, uuid, int, int, text);

CREATE OR REPLACE FUNCTION get_profile_files(
  p_profile_user_id  uuid,
  p_viewer_id        uuid    DEFAULT NULL,
  p_limit            int     DEFAULT 20,
  p_cursor_pos       int     DEFAULT 0,
  -- NULL = every file (back-compat). 'image' = pictures only, 'video' = everything
  -- that isn't a picture (clips, audio, HLS). Lets the profile split Videos/Images.
  p_file_type        text    DEFAULT NULL
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
  user_has_disliked boolean,
  upload_status     text,
  processing_progress smallint,
  total_count       bigint
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_is_owner boolean := (p_viewer_id IS NOT NULL AND p_viewer_id = p_profile_user_id);
BEGIN
  RETURN QUERY
  WITH
  filtered AS (
    SELECT
      f.id,
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
      COALESCE(f.default_thumbnail, (SELECT t #>> '{}' FROM unnest(f.thumbnails) AS t WHERE (t #>> '{}') LIKE '%thumbnail_preview.jpg' LIMIT 1)) AS default_thumbnail,
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
      f.upload_status,
      f.processing_progress,
      -- Live counts via subqueries
      (SELECT COUNT(*) FROM likes l WHERE l.file_id = f.id)::bigint        AS _like_count,
      (SELECT COUNT(*) FROM dislike d WHERE d.file_id = f.id)::bigint      AS _dislike_count,
      (SELECT COUNT(*) FROM comments c WHERE c.file_id = f.id AND c.is_deleted = false)::bigint AS _comment_count,
      -- Viewer interaction status
      (p_viewer_id IS NOT NULL AND EXISTS (SELECT 1 FROM likes l WHERE l.file_id = f.id AND l.user_id = p_viewer_id))   AS _viewer_liked,
      (p_viewer_id IS NOT NULL AND EXISTS (SELECT 1 FROM dislike d WHERE d.file_id = f.id AND d.user_id = p_viewer_id)) AS _viewer_disliked
    FROM files f
    WHERE f.owner_id = p_profile_user_id
      -- Hide episode-only assets everywhere (including owner): only main + regular files
      AND (f.is_series_main OR COALESCE(f.is_files_series_item, false) IS NOT TRUE)
      AND (
        v_is_owner
        OR (
          f.is_public = true
          AND f.is_adult = false
          AND (f.upload_status = 'complete' OR f.upload_status = 'completed')
        )
      )
      -- Optional kind filter for the Videos / Images tabs. Pictures are matched on
      -- their image/* MIME; anything else (video, audio, HLS, or a null type) is a
      -- "video". NULL keeps the old behaviour of returning everything.
      AND (
        p_file_type IS NULL
        OR (lower(p_file_type) = 'image' AND f.file_type ILIKE 'image/%')
        OR (lower(p_file_type) = 'video' AND (f.file_type IS NULL OR f.file_type NOT ILIKE 'image/%'))
      )
  ),
  counted AS (
    SELECT COUNT(*)::bigint AS cnt FROM filtered
  ),
  ranked AS (
    SELECT
      fl.*,
      ROW_NUMBER() OVER (ORDER BY fl.created_at DESC, fl.id DESC) AS _rn
    FROM filtered fl
  )

  SELECT
    r.id,
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
    'profile'::text,
    u.username,
    u.profile_pic,
    u.verified,
    u.about,
    r._viewer_liked,
    r._viewer_disliked,
    r.upload_status,
    r.processing_progress,
    c.cnt
  FROM ranked r
  JOIN users u ON u.id = r.owner_id
  CROSS JOIN counted c
  WHERE r._rn > p_cursor_pos
  ORDER BY r._rn ASC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_profile_files(uuid, uuid, int, int, text) TO anon, authenticated;
