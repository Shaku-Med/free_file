-- ============================================================
-- SEARCH V2: Plain-English search using websearch_to_tsquery
-- + Vision description in full-text index
-- + Fixed metadata paths to match actual stored structure
-- ============================================================

DROP FUNCTION IF EXISTS search_files;

CREATE OR REPLACE FUNCTION search_files(
  p_query         text,
  p_user_id       uuid    DEFAULT NULL,
  p_limit         int     DEFAULT 20,
  p_file_type     text    DEFAULT NULL,
  p_category      text    DEFAULT NULL,
  p_sort_by       text    DEFAULT 'relevance',
  p_cursor_score  float   DEFAULT NULL,
  p_cursor_id     uuid    DEFAULT NULL
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
  owner_username    text,
  owner_profile_pic text,
  owner_verified    boolean,
  search_rank      float,
  user_has_liked    boolean,
  user_has_disliked boolean
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_tsquery tsquery;
  v_pattern text;
  v_nsfw_on boolean;
  v_search_text text;
BEGIN
  -- websearch_to_tsquery handles plain English:
  --   "cute cat"      → phrase match
  --   cat dog         → both must match
  --   cat OR dog      → either matches
  --   -cat            → exclude cat
  v_tsquery := websearch_to_tsquery('english', p_query);
  v_pattern := '%' || lower(p_query) || '%';

  IF p_user_id IS NOT NULL THEN
    SELECT COALESCE(u.show_nsfw, false) INTO v_nsfw_on FROM users u WHERE u.id = p_user_id;
  ELSE
    v_nsfw_on := false;
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
  matches AS (
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

      (ul.file_id IS NOT NULL) AS _user_liked,
      (ud.file_id IS NOT NULL) AS _user_disliked,

      -- Full-text rank across title + description + vision description
      ts_rank_cd(
        to_tsvector('english',
          coalesce(f.file_title, '') || ' ' ||
          coalesce(f.file_description, '') || ' ' ||
          coalesce(f.metadata->>'description', '')
        ),
        v_tsquery, 32
      )::float AS _text_rank,

      CASE WHEN lower(f.file_title) LIKE v_pattern THEN 10.0 ELSE 0.0 END AS _title_boost,

      CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(f.tags) t WHERE lower(t) LIKE v_pattern
      ) THEN 5.0 ELSE 0.0 END AS _tag_boost,

      CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(f.categories) cat WHERE lower(cat) LIKE v_pattern
      ) THEN 3.0 ELSE 0.0 END AS _cat_boost,

      -- Vision metadata boost: search label names + description
      CASE WHEN (
        EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(f.metadata->'labelNames') v
          WHERE lower(v) LIKE v_pattern
        )
        OR lower(f.metadata->>'description') LIKE v_pattern
      ) THEN 4.0 ELSE 0.0 END AS _vision_boost,

      -- Full-text match on vision description (plain English)
      CASE WHEN to_tsvector('english', coalesce(f.metadata->>'description', '')) @@ v_tsquery
        THEN 6.0 ELSE 0.0 END AS _desc_boost

    FROM files f
    LEFT JOIN file_engagement_stats es ON es.file_id = f.id
    LEFT JOIN user_likes ul ON ul.file_id = f.id
    LEFT JOIN user_dislikes ud ON ud.file_id = f.id
    WHERE f.is_public = true
      AND (v_nsfw_on = true OR f.is_adult = false)
      AND f.upload_status = 'complete'
      AND (p_file_type IS NULL OR f.file_type ILIKE (p_file_type || '%'))
      AND (p_category IS NULL OR f.categories @> to_jsonb(p_category)::jsonb)
      AND (
        -- Full-text match on title + description + vision description
        to_tsvector('english',
          coalesce(f.file_title, '') || ' ' ||
          coalesce(f.file_description, '') || ' ' ||
          coalesce(f.metadata->>'description', '')
        ) @@ v_tsquery
        -- Fallback: ILIKE pattern matching
        OR lower(f.file_title) LIKE v_pattern
        OR lower(f.file_description) LIKE v_pattern
        OR lower(f.metadata->>'description') LIKE v_pattern
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(f.tags) t WHERE lower(t) LIKE v_pattern)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(f.categories) cat WHERE lower(cat) LIKE v_pattern)
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(f.metadata->'labelNames') v
          WHERE lower(v) LIKE v_pattern
        )
        OR lower(f.filename) LIKE v_pattern
      )
  ),
  with_rank AS (
    SELECT
      m.*,
      CASE p_sort_by
        WHEN 'recent'  THEN EXTRACT(EPOCH FROM m.created_at)
        WHEN 'popular' THEN (m.view_count + m._like_count + m.share_count)::float
        ELSE (m._text_rank + m._title_boost + m._tag_boost + m._cat_boost + m._vision_boost + m._desc_boost
              + LN(GREATEST(m.view_count + m._like_count + 1, 1))::float * 0.5)
      END AS _final_rank
    FROM matches m
  )
  SELECT
    wr.id,
    wr.created_at,
    wr.endpoint,
    wr.filename,
    wr.unique_id,
    wr.file_size,
    wr.file_type,
    wr.is_adult,
    wr.owner_id,
    wr.is_public,
    wr.file_description,
    wr.file_title,
    wr.thumbnails,
    wr.view_count,
    wr.share_count,
    wr.is_reel,
    wr.duration,
    wr.categories,
    wr.tags,
    wr.colors,
    wr.metadata,
    wr._like_count,
    wr._dislike_count,
    wr._comment_count,
    u.username,
    u.profile_pic,
    u.verified,
    wr._final_rank,
    wr._user_liked,
    wr._user_disliked
  FROM with_rank wr
  JOIN users u ON u.id = wr.owner_id
  WHERE
    CASE WHEN p_cursor_score IS NOT NULL AND p_cursor_id IS NOT NULL THEN
      (wr._final_rank < p_cursor_score)
      OR (wr._final_rank = p_cursor_score AND wr.id > p_cursor_id)
    ELSE true END
  ORDER BY wr._final_rank DESC, wr.id ASC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION search_files TO anon, authenticated;
