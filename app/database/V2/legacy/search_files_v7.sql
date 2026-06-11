-- ============================================================
-- SEARCH V7: semantic vector search (pgvector) + v4 lexical
-- ============================================================
-- v7 = v6 with the function-level `SET pg_trgm.word_similarity_threshold`
-- removed: Supabase / many roles lack permission to bind custom GUCs on
-- functions (ERROR 42501). Trigram `<%` now uses the database default
-- threshold, same approach as search_series_roots_for_query.sql.
--
-- Requires search_files_v4.sql (search_normalize + files.search_text).
-- Replaces search_files_v5's synonym dictionary with REAL semantics:
-- the EmbedAPI sidecar (BAAI/bge-small-en-v1.5, 384 dims) embeds every
-- file at upload time and every query at search time; pgvector finds
-- nearest neighbors via an HNSW index. "cat" matches "pussy" because
-- the model knows they're related  no dictionary, no maintenance.
--
-- Flow:
--   upload:  GoUpload worker -> EmbedAPI -> webhook carries `embedding`
--            -> app calls set_file_embedding()
--   search:  app -> GoUpload /internal/embed (server secret) -> vector
--            -> search_files(p_query_embedding => '[...]')
--   The embed sidecar down? p_query_embedding stays NULL and search is
--   plain lexical  feature degrades, never breaks.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ------------------------------------------------------------
-- 1. Embedding column + HNSW index (cosine).
-- ------------------------------------------------------------
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS embedding vector(384);

CREATE INDEX IF NOT EXISTS idx_files_embedding_hnsw
  ON public.files USING hnsw (embedding vector_cosine_ops);

-- ------------------------------------------------------------
-- 2. set_file_embedding  called by the app's upload webhook (and the
--    one-time backfill script). Server-only.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.set_file_embedding(text, text);

CREATE OR REPLACE FUNCTION public.set_file_embedding(
  p_unique_id text,
  p_embedding text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vec vector(384);
BEGIN
  IF p_unique_id IS NULL OR p_unique_id = '' THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  IF p_embedding IS NULL OR length(p_embedding) < 3 OR length(p_embedding) > 20000 THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  BEGIN
    v_vec := p_embedding::vector(384);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false);
  END;

  UPDATE files SET embedding = v_vec WHERE unique_id = p_unique_id;
  RETURN jsonb_build_object('ok', FOUND);
END;
$$;

REVOKE ALL ON FUNCTION public.set_file_embedding(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_file_embedding(text, text) TO service_role;

-- ------------------------------------------------------------
-- 3. Retire the v5 synonym machinery  embeddings replace it.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.search_expand_synonyms(text);
DROP TABLE IF EXISTS public.search_synonyms;

-- ------------------------------------------------------------
-- 4. search_files v6  v4 lexical + semantic nearest-neighbor branch.
--    Same return shape; new optional p_query_embedding param keeps old
--    callers working unchanged.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS search_files;

CREATE OR REPLACE FUNCTION search_files(
  p_query           text,
  p_user_id         uuid    DEFAULT NULL,
  p_limit           int     DEFAULT 20,
  p_file_type       text    DEFAULT NULL,
  p_category        text    DEFAULT NULL,
  p_sort_by         text    DEFAULT 'relevance',
  p_cursor_score    float   DEFAULT NULL,
  p_cursor_id       uuid    DEFAULT NULL,
  p_query_embedding text    DEFAULT NULL
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
-- permission to bind custom GUCs on functions (ERROR 42501). The `<%`
-- operator uses the database default threshold instead.
AS $$
DECLARE
  v_norm    text;
  v_tsquery tsquery;
  v_qvec    vector(384) := NULL;
BEGIN
  v_norm := search_normalize(p_query);
  v_tsquery := websearch_to_tsquery('english', v_norm);

  -- Query vector from the app (text form '[0.1,...]'). Bad input never
  -- breaks search  the semantic branch just turns off.
  IF p_query_embedding IS NOT NULL AND length(p_query_embedding) BETWEEN 3 AND 20000 THEN
    BEGIN
      v_qvec := p_query_embedding::vector(384);
    EXCEPTION WHEN OTHERS THEN
      v_qvec := NULL;
    END;
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
  -- Semantic candidates: top-80 nearest neighbors over the HNSW index,
  -- floored at cosine similarity 0.55 so vague neighbors don't leak in.
  -- bge relevant pairs typically land 0.70+; unrelated ~0.50.
  semantic AS (
    SELECT s.file_id, s.sim FROM (
      SELECT f.id AS file_id, (1 - (f.embedding <=> v_qvec))::float AS sim
      FROM files f
      WHERE v_qvec IS NOT NULL
        AND f.embedding IS NOT NULL
        AND f.is_public = true
        AND f.is_adult = false
        AND f.upload_status = 'complete'
      ORDER BY f.embedding <=> v_qvec
      LIMIT 80
    ) s
    WHERE s.sim >= 0.55
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
      COALESCE(
        f.default_thumbnail,
        (SELECT t #>> '{}' FROM unnest(f.thumbnails) AS t
          WHERE (t #>> '{}') LIKE '%thumbnail_preview.jpg' LIMIT 1)
      ) AS default_thumbnail,
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

      ts_rank_cd(to_tsvector('english', f.search_text), v_tsquery, 32)::float AS _text_rank,
      COALESCE(sem.sim, 0.0)::float                                           AS _sem_sim,
      word_similarity(v_norm, f.search_text)::float                           AS _wsim,
      word_similarity(v_norm, lower(COALESCE(f.file_title, '')))::float       AS _wsim_title,
      CASE WHEN lower(COALESCE(f.file_title, '')) LIKE '%' || v_norm || '%'
           THEN 1.0 ELSE 0.0 END                                              AS _title_hit
    FROM files f
    LEFT JOIN file_engagement_stats es ON es.file_id = f.id
    LEFT JOIN user_likes    ul ON ul.file_id = f.id
    LEFT JOIN user_dislikes ud ON ud.file_id = f.id
    LEFT JOIN semantic     sem ON sem.file_id = f.id
    WHERE f.is_public = true
      AND f.is_adult = false
      AND f.upload_status = 'complete'
      AND (f.is_series_main OR COALESCE(f.is_files_series_item, false) IS NOT TRUE)
      AND (p_file_type IS NULL OR f.file_type ILIKE (p_file_type || '%'))
      AND (p_category  IS NULL OR f.categories @> to_jsonb(p_category)::jsonb)
      AND (
           to_tsvector('english', f.search_text) @@ v_tsquery
        OR f.search_text ILIKE '%' || v_norm || '%'
        -- <% operator uses the GIN trgm index with the threshold set above (0.4).
        OR v_norm <% f.search_text
        -- Semantic branch: doc says "pussy", user typed "cat".
        OR sem.file_id IS NOT NULL
      )
  ),
  with_rank AS (
    SELECT
      m.*,
      CASE p_sort_by
        WHEN 'recent'  THEN EXTRACT(EPOCH FROM m.created_at)
        WHEN 'popular' THEN (m.view_count + m._like_count + m.share_count)::float
        ELSE (
            m._text_rank    * 8.0
          -- Similarity above the 0.55 noise floor, rescaled: a 0.90 match
          -- adds ~8.7  competitive with a direct text hit, never above an
          -- exact title hit.
          + GREATEST(m._sem_sim - 0.55, 0.0) * 25.0
          + m._wsim         * 5.0
          + m._wsim_title   * 4.0
          + m._title_hit    * 6.0
          + LN(GREATEST(m.view_count + m._like_count + 1, 1))::float * 0.5
        )
      END AS _final_rank
    FROM matches m
  )
  SELECT
    wr.id, wr.created_at, wr.endpoint, wr.filename, wr.unique_id,
    wr.file_size, wr.file_type, wr.is_adult, wr.owner_id, wr.is_public,
    wr.file_description, wr.file_title, wr.default_thumbnail,
    wr.view_count, wr.share_count, wr.is_reel, wr.is_series_main,
    wr.is_files_series_item, wr.file_series_id, wr.file_series_episode_id,
    wr.duration, wr.categories, wr.tags, wr.colors, wr.metadata,
    wr._like_count, wr._dislike_count, wr._comment_count,
    u.username, u.profile_pic, u.verified,
    wr._final_rank, wr._user_liked, wr._user_disliked
  FROM with_rank wr
  JOIN users u ON u.id = wr.owner_id
  WHERE
    CASE WHEN p_cursor_score IS NOT NULL AND p_cursor_id IS NOT NULL THEN
      (wr._final_rank < p_cursor_score)
      OR (wr._final_rank = p_cursor_score AND wr.id > p_cursor_id)
    ELSE true END
  ORDER BY wr._final_rank DESC, wr.id ASC
  LIMIT p_limit;
END $$;

GRANT EXECUTE ON FUNCTION search_files TO anon, authenticated;
