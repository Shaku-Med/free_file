-- ============================================================
-- Search: series roots discovered via episode / item text match
-- Surfaces series main rows when the query hits:
--   • series item VIDEO rows (files.is_files_series_item) — titles, descriptions, etc.
--   • episode bucket titles in table files_series_episodes (episode_name, e.g. "Season 1")
-- Same return shape as search_files for the app. Depends: search_normalize(),
-- files.search_text, tables files / files_series_episodes.
-- ============================================================

CREATE OR REPLACE FUNCTION search_series_roots_for_query(
  p_query         text,
  p_user_id       uuid    DEFAULT NULL,
  p_limit         int     DEFAULT 8
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
LANGUAGE plpgsql STABLE
-- No SET pg_trgm.word_similarity_threshold here: Supabase / many roles lack
-- permission to bind custom GUCs on functions (ERROR 42501).
-- Trigram ops use the database default threshold (often 0.3).
AS $$
DECLARE
  v_norm    text;
  v_tsquery tsquery;
BEGIN
  v_norm := search_normalize(p_query);
  v_tsquery := websearch_to_tsquery('english', v_norm);

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
  episode_matches AS (
    SELECT
      f.id,
      f.file_series_id,
      f.owner_id,
      f.view_count,
      COALESCE(es.like_count, 0)    AS _like_count,
      (ul.file_id IS NOT NULL) AS _user_liked,
      (ud.file_id IS NOT NULL) AS _user_disliked,
      ts_rank_cd(to_tsvector('english', f.search_text), v_tsquery, 32)::float AS _text_rank,
      word_similarity(v_norm, f.search_text)::float                           AS _wsim,
      word_similarity(v_norm, lower(COALESCE(f.file_title, '')))::float       AS _wsim_title,
      CASE WHEN lower(COALESCE(f.file_title, '')) LIKE '%' || v_norm || '%'
           THEN 1.0 ELSE 0.0 END                                              AS _title_hit,

      ts_rank_cd(
        to_tsvector('english', search_normalize(COALESCE(epi.episode_name, ''))),
        v_tsquery, 32
      )::float AS _text_rank_ep_nm,
      word_similarity(
        v_norm,
        search_normalize(COALESCE(epi.episode_name, ''))
      )::float AS _wsim_ep_nm,
      CASE WHEN search_normalize(COALESCE(epi.episode_name, '')) LIKE '%' || v_norm || '%'
           THEN 1.0 ELSE 0.0 END                                              AS _ep_nm_hit
    FROM files f
    LEFT JOIN files_series_episodes epi
      ON epi.id = f.file_series_episode_id
    LEFT JOIN file_engagement_stats es ON es.file_id = f.id
    LEFT JOIN user_likes    ul ON ul.file_id = f.id
    LEFT JOIN user_dislikes ud ON ud.file_id = f.id
    WHERE f.is_public = true
      AND f.is_adult = false
      AND f.upload_status = 'complete'
      AND COALESCE(f.is_files_series_item, false) = true
      AND f.file_series_id IS NOT NULL
      AND (
           to_tsvector('english', f.search_text) @@ v_tsquery
        OR f.search_text ILIKE '%' || v_norm || '%'
        OR v_norm <% f.search_text
        OR (
            epi.id IS NOT NULL AND (
                 to_tsvector('english', search_normalize(COALESCE(epi.episode_name, ''))) @@ v_tsquery
              OR search_normalize(COALESCE(epi.episode_name, '')) ILIKE '%' || v_norm || '%'
              OR v_norm <% search_normalize(COALESCE(epi.episode_name, ''))
            )
           )
      )
  ),
  -- Episode bucket label alone (Season 1, Pilot) when no matching file blob.
  episode_definition_matches AS (
    SELECT
      e.feed_series_id AS file_series_id,
      (
          ts_rank_cd(
            to_tsvector('english', search_normalize(COALESCE(e.episode_name, ''))),
            v_tsquery, 32
          )::float * 8.0
        + word_similarity(
          v_norm,
          search_normalize(COALESCE(e.episode_name, ''))
        )::float * 5.0
        + CASE WHEN search_normalize(COALESCE(e.episode_name, '')) LIKE '%' || v_norm || '%'
               THEN 6.0 ELSE 0 END
      )::float AS _episode_rank
    FROM files_series_episodes e
    WHERE EXISTS (
      SELECT 1 FROM files mb
      WHERE mb.file_series_id = e.feed_series_id
        AND mb.is_series_main IS TRUE
        AND mb.is_public IS TRUE AND mb.is_adult IS FALSE
        AND mb.upload_status = 'complete'
    )
      AND (
           to_tsvector('english', search_normalize(COALESCE(e.episode_name, ''))) @@ v_tsquery
        OR search_normalize(COALESCE(e.episode_name, '')) ILIKE '%' || v_norm || '%'
        OR v_norm <% search_normalize(COALESCE(e.episode_name, ''))
      )
  ),
  episode_ranked AS (
    SELECT
      em.*,
      (
          em._text_rank      * 8.0
        + em._wsim           * 5.0
        + em._wsim_title     * 4.0
        + em._title_hit      * 6.0
        + em._text_rank_ep_nm * 8.0
        + em._wsim_ep_nm     * 5.0
        + em._ep_nm_hit      * 6.0
        + LN(GREATEST(em.view_count + em._like_count + 1, 1))::float * 0.5
      )::float AS _episode_rank
    FROM episode_matches em
  ),
  ranked_union AS (
    SELECT er.file_series_id, er._episode_rank FROM episode_ranked er
    UNION ALL
    SELECT edm.file_series_id, edm._episode_rank FROM episode_definition_matches edm
  ),
  best_episode AS (
    SELECT DISTINCT ON (ru.file_series_id)
      ru.file_series_id,
      ru._episode_rank
    FROM ranked_union ru
    ORDER BY ru.file_series_id, ru._episode_rank DESC
  ),
  mains AS (
    SELECT
      m.id,
      m.created_at,
      m.endpoint,
      m.filename,
      m.unique_id,
      m.file_size,
      m.file_type,
      m.is_adult,
      m.owner_id,
      m.is_public,
      m.file_description,
      m.file_title,
      COALESCE(
        m.default_thumbnail,
        (SELECT t #>> '{}' FROM unnest(m.thumbnails) AS t
          WHERE (t #>> '{}') LIKE '%thumbnail_preview.jpg' LIMIT 1)
      ) AS default_thumbnail,
      m.view_count,
      m.share_count,
      m.is_reel,
      m.is_series_main,
      m.is_files_series_item,
      m.file_series_id,
      m.file_series_episode_id,
      m.duration,
      m.categories,
      m.tags,
      m.colors,
      m.metadata,
      COALESCE(es.like_count, 0)    AS _like_count,
      COALESCE(es.dislike_count, 0) AS _dislike_count,
      COALESCE(es.comment_count, 0) AS _comment_count,
      (ul.file_id IS NOT NULL) AS _user_liked,
      (ud.file_id IS NOT NULL) AS _user_disliked,
      be._episode_rank AS _final_rank
    FROM files m
    JOIN best_episode be ON be.file_series_id = m.file_series_id
    LEFT JOIN file_engagement_stats es ON es.file_id = m.id
    LEFT JOIN user_likes    ul ON ul.file_id = m.id
    LEFT JOIN user_dislikes ud ON ud.file_id = m.id
    WHERE m.is_public = true
      AND m.is_adult = false
      AND m.upload_status = 'complete'
      AND COALESCE(m.is_series_main, false) = true
      AND m.file_series_id IS NOT NULL
  )
  SELECT
    mn.id, mn.created_at, mn.endpoint, mn.filename, mn.unique_id,
    mn.file_size, mn.file_type, mn.is_adult, mn.owner_id, mn.is_public,
    mn.file_description, mn.file_title, mn.default_thumbnail,
    mn.view_count, mn.share_count, mn.is_reel, mn.is_series_main,
    mn.is_files_series_item, mn.file_series_id, mn.file_series_episode_id,
    mn.duration, mn.categories, mn.tags, mn.colors, mn.metadata,
    mn._like_count, mn._dislike_count, mn._comment_count,
    u.username, u.profile_pic, u.verified,
    mn._final_rank::float, mn._user_liked, mn._user_disliked
  FROM mains mn
  JOIN users u ON u.id = mn.owner_id
  ORDER BY mn._final_rank DESC, mn.id ASC
  LIMIT p_limit;
END $$;

GRANT EXECUTE ON FUNCTION search_series_roots_for_query TO anon, authenticated;
