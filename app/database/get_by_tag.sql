-- ============================================================
-- get_by_tag — Tag page feed: match tag in tags, categories,
-- file_title, or file_description. Cursor pagination, sort options.
-- ============================================================

DROP FUNCTION IF EXISTS get_by_tag(text, uuid, int, float, uuid, text, boolean);

CREATE OR REPLACE FUNCTION get_by_tag(
  p_tag           text,
  p_user_id       uuid    DEFAULT NULL,
  p_limit         int     DEFAULT 20,
  p_cursor_score  float   DEFAULT NULL,
  p_cursor_id     uuid    DEFAULT NULL,
  p_sort_by       text    DEFAULT 'best',
  p_reels_only    boolean DEFAULT false
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
  duration         numeric,
  categories       jsonb,
  tags             jsonb,
  colors           jsonb,
  metadata         jsonb,
  like_count       bigint,
  dislike_count    bigint,
  comment_count    bigint,
  tag_score        float,
  owner_username   text,
  owner_profile_pic text,
  owner_verified   boolean,
  owner_about      text,
  user_has_liked   boolean,
  user_has_disliked boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tag     text := lower(trim(p_tag));
  v_escaped text := replace(replace(replace(v_tag, '\', '\\'), '%', '\%'), '_', '\_');
  v_pattern text := '%' || v_escaped || '%';
BEGIN
  IF v_tag = '' THEN
    RETURN;
  END IF;

  -- v_nsfw_on removed — never show adult content

  RETURN QUERY
  WITH
  user_likes AS (
    SELECT l.file_id FROM likes l
    WHERE l.user_id = p_user_id AND p_user_id IS NOT NULL
  ),
  user_dislikes AS (
    SELECT d.file_id FROM dislike d
    WHERE d.user_id = p_user_id AND p_user_id IS NOT NULL
  ),
  base AS (
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
      f.duration,
      f.categories,
      f.tags,
      f.colors,
      f.metadata,
      COALESCE(es.like_count, 0)::bigint    AS _like_count,
      COALESCE(es.dislike_count, 0)::bigint AS _dislike_count,
      COALESCE(es.comment_count, 0)::bigint AS _comment_count,
      (ul.file_id IS NOT NULL)             AS _user_liked,
      (ud.file_id IS NOT NULL)             AS _user_disliked,
      (COALESCE(es.like_count, 0) + COALESCE(es.comment_count, 0) + f.share_count + f.view_count)::float AS _eng
    FROM files f
    LEFT JOIN file_engagement_stats es ON es.file_id = f.id
    LEFT JOIN user_likes ul ON ul.file_id = f.id
    LEFT JOIN user_dislikes ud ON ud.file_id = f.id
    WHERE f.is_public = true
      AND f.is_adult = false              -- HARD BLOCK: never show adult content
      AND f.upload_status = 'complete'
      AND (f.series_id IS NULL OR f.is_series_main = true)  -- hide series sub-episodes
      AND (p_reels_only = false OR f.is_reel = true)
      AND (
        EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(f.tags, '[]'::jsonb)) AS tr(tag_txt)
          WHERE lower(trim(tr.tag_txt)) = v_tag
        )
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(f.categories, '[]'::jsonb)) AS cr(cat_txt)
          WHERE lower(trim(cr.cat_txt)) = v_tag
        )
        OR f.file_title ILIKE v_pattern ESCAPE '\'
        OR COALESCE(f.file_description, '') ILIKE v_pattern ESCAPE '\'
      )
  ),
  with_score AS (
    SELECT
      b.*,
      CASE p_sort_by
        WHEN 'recent'  THEN EXTRACT(EPOCH FROM b.created_at)::float
        WHEN 'popular' THEN (b.view_count + b._like_count + b.share_count)::float
        ELSE b._eng
      END AS _sort_score
    FROM base b
  )
  SELECT
    ws.id,
    ws.created_at,
    ws.endpoint,
    ws.filename,
    ws.unique_id,
    ws.file_size,
    ws.file_type,
    ws.is_adult,
    ws.owner_id,
    ws.is_public,
    ws.file_description,
    ws.file_title,
    ws.default_thumbnail,
    ws.view_count,
    ws.share_count,
    ws.is_reel,
    ws.duration,
    ws.categories,
    ws.tags,
    ws.colors,
    ws.metadata,
    ws._like_count,
    ws._dislike_count,
    ws._comment_count,
    ws._sort_score,
    u.username,
    u.profile_pic,
    u.verified,
    u.about,
    ws._user_liked,
    ws._user_disliked
  FROM with_score ws
  JOIN users u ON u.id = ws.owner_id
  WHERE
    CASE
      WHEN p_cursor_score IS NOT NULL AND p_cursor_id IS NOT NULL THEN
        (ws._sort_score < p_cursor_score)
        OR (ws._sort_score = p_cursor_score AND ws.id > p_cursor_id)
      ELSE true
    END
  ORDER BY ws._sort_score DESC, ws.id ASC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_by_tag TO anon, authenticated;