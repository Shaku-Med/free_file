-- ============================================================
-- SEARCH V3: Smart search with query expansion + fuzzy matching
-- ============================================================
-- Upgrades over v2:
--   1. p_alt_terms: expanded query variants (numbers↔words, compound splits)
--      e.g. "67" also matches "sixty seven", "six seven"
--   2. pg_trgm fuzzy matching for typo tolerance
--   3. Alt-term LIKE matching so expanded forms find results
--   4. Better ranking: primary match > alt match > fuzzy match
-- Requires: CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DROP FUNCTION IF EXISTS search_files;

CREATE OR REPLACE FUNCTION search_files(
  p_query         text,
  p_user_id       uuid    DEFAULT NULL,
  p_limit         int     DEFAULT 20,
  p_file_type     text    DEFAULT NULL,
  p_category      text    DEFAULT NULL,
  p_sort_by       text    DEFAULT 'relevance',
  p_cursor_score  float   DEFAULT NULL,
  p_cursor_id     uuid    DEFAULT NULL,
  p_alt_terms     text[]  DEFAULT NULL
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
  v_has_alts boolean;
BEGIN
  v_tsquery := websearch_to_tsquery('english', p_query);
  v_pattern := '%' || lower(p_query) || '%';
  v_has_alts := (p_alt_terms IS NOT NULL AND array_length(p_alt_terms, 1) > 0);

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

  -- Build a searchable text blob once per file for matching
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

      COALESCE(es.like_count, 0)    AS _like_count,
      COALESCE(es.dislike_count, 0) AS _dislike_count,
      COALESCE(es.comment_count, 0) AS _comment_count,

      (ul.file_id IS NOT NULL) AS _user_liked,
      (ud.file_id IS NOT NULL) AS _user_disliked,

      -- Full-text rank for primary query
      ts_rank_cd(
        to_tsvector('english',
          coalesce(f.file_title, '') || ' ' ||
          coalesce(f.file_description, '') || ' ' ||
          coalesce(f.metadata->>'description', '')
        ),
        v_tsquery, 32
      )::float AS _text_rank,

      -- Primary term boosts
      CASE WHEN lower(f.file_title) LIKE v_pattern THEN 10.0 ELSE 0.0 END AS _title_boost,
      CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(f.tags, '[]'::jsonb)) AS tag_r(tag_txt)
        WHERE lower(tag_r.tag_txt) LIKE v_pattern
      ) THEN 5.0 ELSE 0.0 END AS _tag_boost,
      CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(f.categories, '[]'::jsonb)) AS cat_r(cat_txt)
        WHERE lower(cat_r.cat_txt) LIKE v_pattern
      ) THEN 3.0 ELSE 0.0 END AS _cat_boost,
      CASE WHEN (
        EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(f.metadata->'labelNames') = 'array' THEN f.metadata->'labelNames' ELSE '[]'::jsonb END
          ) AS lbl_r(lbl_txt)
          WHERE lower(lbl_r.lbl_txt) LIKE v_pattern
        )
        OR lower(f.metadata->>'description') LIKE v_pattern
      ) THEN 4.0 ELSE 0.0 END AS _vision_boost,
      CASE WHEN to_tsvector('english', coalesce(f.metadata->>'description', '')) @@ v_tsquery
        THEN 6.0 ELSE 0.0 END AS _desc_boost,

      -- ALT-TERM boost: expanded forms (e.g. "sixty seven" when user searched "67")
      CASE WHEN v_has_alts AND EXISTS (
        SELECT 1 FROM unnest(p_alt_terms) AS alt(term)
        WHERE lower(f.file_title) LIKE '%' || lower(alt.term) || '%'
           OR lower(f.file_description) LIKE '%' || lower(alt.term) || '%'
           OR lower(f.metadata->>'description') LIKE '%' || lower(alt.term) || '%'
           OR EXISTS (
             SELECT 1 FROM jsonb_array_elements_text(COALESCE(f.tags, '[]'::jsonb)) AS tr(t)
             WHERE lower(tr.t) LIKE '%' || lower(alt.term) || '%'
           )
      ) THEN 7.0 ELSE 0.0 END AS _alt_boost,

      -- Trigram fuzzy match on title (catches typos like "spiderman" vs "spider-man")
      GREATEST(
        similarity(lower(coalesce(f.file_title, '')), lower(p_query)),
        word_similarity(lower(p_query), lower(coalesce(f.file_title, '')))
      )::float AS _fuzzy_title,

      -- Trigram fuzzy on tags
      COALESCE(
        (SELECT MAX(similarity(lower(tr.t), lower(p_query)))
         FROM jsonb_array_elements_text(COALESCE(f.tags, '[]'::jsonb)) AS tr(t)),
        0.0
      )::float AS _fuzzy_tags

    FROM files f
    LEFT JOIN file_engagement_stats es ON es.file_id = f.id
    LEFT JOIN user_likes ul ON ul.file_id = f.id
    LEFT JOIN user_dislikes ud ON ud.file_id = f.id
    WHERE f.is_public = true
      AND f.is_adult = false
      AND f.upload_status = 'complete'
      AND (f.is_series_main OR COALESCE(f.is_files_series_item, false) IS NOT TRUE)
      AND (p_file_type IS NULL OR f.file_type ILIKE (p_file_type || '%'))
      AND (p_category IS NULL OR f.categories @> to_jsonb(p_category)::jsonb)
      AND (
        -- Primary query matches (same as v2)
        to_tsvector('english',
          coalesce(f.file_title, '') || ' ' ||
          coalesce(f.file_description, '') || ' ' ||
          coalesce(f.metadata->>'description', '')
        ) @@ v_tsquery
        OR lower(f.file_title) LIKE v_pattern
        OR lower(f.file_description) LIKE v_pattern
        OR lower(f.metadata->>'description') LIKE v_pattern
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(f.tags, '[]'::jsonb)) AS tag_r(tag_txt)
          WHERE lower(tag_r.tag_txt) LIKE v_pattern
        )
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(f.categories, '[]'::jsonb)) AS cat_r(cat_txt)
          WHERE lower(cat_r.cat_txt) LIKE v_pattern
        )
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(f.metadata->'labelNames') = 'array' THEN f.metadata->'labelNames' ELSE '[]'::jsonb END
          ) AS lbl_r(lbl_txt)
          WHERE lower(lbl_r.lbl_txt) LIKE v_pattern
        )
        OR lower(f.filename) LIKE v_pattern

        -- NEW: Expanded alt-term matches (numbers↔words, compound splits)
        OR (v_has_alts AND EXISTS (
          SELECT 1 FROM unnest(p_alt_terms) AS alt(term)
          WHERE lower(f.file_title) LIKE '%' || lower(alt.term) || '%'
             OR lower(f.file_description) LIKE '%' || lower(alt.term) || '%'
             OR lower(f.metadata->>'description') LIKE '%' || lower(alt.term) || '%'
             OR lower(f.filename) LIKE '%' || lower(alt.term) || '%'
             OR EXISTS (
               SELECT 1 FROM jsonb_array_elements_text(COALESCE(f.tags, '[]'::jsonb)) AS tr(t)
               WHERE lower(tr.t) LIKE '%' || lower(alt.term) || '%'
             )
             OR EXISTS (
               SELECT 1 FROM jsonb_array_elements_text(COALESCE(f.categories, '[]'::jsonb)) AS cr(c)
               WHERE lower(cr.c) LIKE '%' || lower(alt.term) || '%'
             )
        ))

        -- NEW: Fuzzy trigram match (typo tolerance, ≥ 0.3 similarity)
        OR similarity(lower(coalesce(f.file_title, '')), lower(p_query)) > 0.3
        OR word_similarity(lower(p_query), lower(coalesce(f.file_title, ''))) > 0.35
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(f.tags, '[]'::jsonb)) AS tr(t)
          WHERE similarity(lower(tr.t), lower(p_query)) > 0.4
        )
      )
  ),
  with_rank AS (
    SELECT
      m.*,
      CASE p_sort_by
        WHEN 'recent'  THEN EXTRACT(EPOCH FROM m.created_at)
        WHEN 'popular' THEN (m.view_count + m._like_count + m.share_count)::float
        ELSE (
          -- Primary match signals (highest weight)
          m._text_rank * 2.0
          + m._title_boost
          + m._tag_boost
          + m._cat_boost
          + m._vision_boost
          + m._desc_boost
          -- Alt-term expansion matches
          + m._alt_boost
          -- Fuzzy similarity bonus (scaled)
          + m._fuzzy_title * 6.0
          + m._fuzzy_tags * 3.0
          -- Engagement signal
          + LN(GREATEST(m.view_count + m._like_count + 1, 1))::float * 0.5
        )
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
    wr.default_thumbnail,
    wr.view_count,
    wr.share_count,
    wr.is_reel,
    wr.is_series_main,
    wr.is_files_series_item,
    wr.file_series_id,
    wr.file_series_episode_id,
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
