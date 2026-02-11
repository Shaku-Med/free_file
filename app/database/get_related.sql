-- ============================================================
-- get_related — Related videos/files for a given file
-- ============================================================
-- Returns content related by: same owner, shared tags, shared
-- categories, same file type, then fallback by engagement/recency.
-- Pagination: p_cursor_pos (0, 20, 40...) and p_limit.
-- ============================================================

CREATE OR REPLACE FUNCTION get_related(
  p_file_id      uuid,
  p_user_id      uuid    DEFAULT NULL,
  p_limit        int     DEFAULT 20,
  p_cursor_pos   int     DEFAULT 0,
  p_exclude_ids  uuid[]  DEFAULT '{}'::uuid[]
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
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_nsfw_on   boolean;
  v_owner_id  uuid;
  v_tags      jsonb;
  v_categories jsonb;
  v_file_type text;
BEGIN
  IF p_user_id IS NOT NULL THEN
    SELECT COALESCE(u.show_nsfw, false) INTO v_nsfw_on FROM users u WHERE u.id = p_user_id;
  ELSE
    v_nsfw_on := false;
  END IF;

  -- Source file (for relevance scoring)
  SELECT f.owner_id, f.tags, f.categories, f.file_type
  INTO v_owner_id, v_tags, v_categories, v_file_type
  FROM files f
  WHERE f.id = p_file_id AND f.is_public = true;

  -- If source missing or private, return nothing
  IF v_owner_id IS NULL THEN
    RETURN;
  END IF;

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
  candidates AS (
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
      f.thumbnails,
      f.view_count,
      f.share_count,
      f.is_reel,
      f.duration,
      f.categories,
      f.tags,
      f.colors,
      f.metadata,
      COALESCE(es.like_count, 0)    AS _like_count,
      COALESCE(es.dislike_count, 0) AS _dislike_count,
      COALESCE(es.comment_count, 0) AS _comment_count,
      (ul.file_id IS NOT NULL)      AS _user_liked,
      (ud.file_id IS NOT NULL)      AS _user_disliked,
      -- Relevance score: same owner > tags > categories > same type > 0
      (
        CASE WHEN f.owner_id = v_owner_id THEN 100.0 ELSE 0.0 END
        + CASE
            WHEN v_tags IS NOT NULL AND f.tags IS NOT NULL
                 AND EXISTS (
                   SELECT 1 FROM jsonb_array_elements_text(v_tags) vt
                   JOIN jsonb_array_elements_text(f.tags) ft ON vt = ft
                 )
            THEN 50.0
            ELSE 0.0
          END
        + CASE
            WHEN v_categories IS NOT NULL AND f.categories IS NOT NULL
                 AND EXISTS (
                   SELECT 1 FROM jsonb_array_elements_text(v_categories) vc
                   JOIN jsonb_array_elements_text(f.categories) fc ON vc = fc
                 )
            THEN 25.0
            ELSE 0.0
          END
        + CASE
            WHEN v_file_type IS NOT NULL AND f.file_type IS NOT NULL
                 AND split_part(f.file_type, '/', 1) = split_part(v_file_type, '/', 1)
            THEN 20.0
            ELSE 0.0
          END
      )::float AS _rel_score,
      (COALESCE(es.like_count, 0) + COALESCE(es.comment_count, 0) + f.share_count + f.view_count)::float AS _total_eng
    FROM files f
    LEFT JOIN file_engagement_stats es ON es.file_id = f.id
    LEFT JOIN user_likes ul ON ul.file_id = f.id
    LEFT JOIN user_dislikes ud ON ud.file_id = f.id
    WHERE f.id != p_file_id
      AND f.is_public = true
      AND (v_nsfw_on = true OR f.is_adult = false)
      AND f.upload_status = 'complete'
      AND (p_user_id IS NULL OR ud.file_id IS NULL)
      AND (p_exclude_ids = '{}'::uuid[] OR f.id != ALL(p_exclude_ids))
  ),
  ranked AS (
    SELECT c.*,
      ROW_NUMBER() OVER (
        ORDER BY c._rel_score DESC,
          LN(GREATEST(c._total_eng, 1)) DESC,
          c.created_at DESC,
          c.id
      ) AS _rn
    FROM candidates c
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
    r.thumbnails,
    r.view_count,
    r.share_count,
    r.is_reel,
    r.duration,
    r.categories,
    r.tags,
    r.colors,
    r.metadata,
    r._like_count,
    r._dislike_count,
    r._comment_count,
    (r._rel_score + LN(GREATEST(r._total_eng, 1))::float * 0.1)::float AS engagement_score,
    'related'::text AS feed_pool,
    u.username,
    u.profile_pic,
    u.verified,
    u.about,
    r._user_liked,
    r._user_disliked
  FROM ranked r
  JOIN users u ON u.id = r.owner_id
  WHERE r._rn > p_cursor_pos
  ORDER BY r._rn ASC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_related TO anon, authenticated;
