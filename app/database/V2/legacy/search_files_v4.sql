-- ============================================================
-- SEARCH V4: Index-time normalization + fuzzy + FTS
-- ============================================================
-- Replaces v3's client-side query expansion. Both the indexed text
-- and the user query pass through the SAME search_normalize() function,
-- so "67" and "sixty seven" collide naturally in storage instead of
-- via brittle alt-term OR matching.
--
-- Heads up: adding the STORED generated column triggers a one-time
-- table rewrite. Run during low-traffic window. After this lands,
-- inserts/updates auto-populate search_text  no app changes needed
-- for indexing.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ------------------------------------------------------------
-- 1. Number ↔ word helpers (IMMUTABLE so they're usable in
--    generated columns and expression indexes).
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION search_number_to_words(n int)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  ones text[] := ARRAY['','one','two','three','four','five','six','seven','eight','nine',
    'ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  tens text[] := ARRAY['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  result text := '';
BEGIN
  IF n IS NULL OR n < 0 OR n > 9999 THEN RETURN ''; END IF;
  IF n = 0 THEN RETURN 'zero'; END IF;

  IF n >= 1000 THEN
    result := ones[(n/1000)+1] || ' thousand';
    n := n % 1000;
    IF n > 0 THEN result := result || ' '; END IF;
  END IF;
  IF n >= 100 THEN
    result := result || ones[(n/100)+1] || ' hundred';
    n := n % 100;
    IF n > 0 THEN result := result || ' '; END IF;
  END IF;
  IF n >= 20 THEN
    result := result || tens[(n/10)+1];
    IF n % 10 > 0 THEN result := result || ' ' || ones[(n%10)+1]; END IF;
  ELSIF n > 0 THEN
    result := result || ones[n+1];
  END IF;
  RETURN result;
END $$;

-- Convert any number-word phrases inside a string to their digit form.
-- Returns ONLY the appended digit tokens, joined by spaces. The caller
-- concatenates this onto the original text so both forms are searchable.
CREATE OR REPLACE FUNCTION search_words_to_numbers(input text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  ones_map jsonb := '{"zero":0,"one":1,"two":2,"three":3,"four":4,"five":5,"six":6,"seven":7,"eight":8,"nine":9,
    "ten":10,"eleven":11,"twelve":12,"thirteen":13,"fourteen":14,"fifteen":15,"sixteen":16,"seventeen":17,"eighteen":18,"nineteen":19}'::jsonb;
  tens_map jsonb := '{"twenty":20,"thirty":30,"forty":40,"fifty":50,"sixty":60,"seventy":70,"eighty":80,"ninety":90}'::jsonb;
  tokens text[];
  n int;
  i int := 1;
  cur int;
  word text;
  appended text := '';
BEGIN
  IF input IS NULL OR input = '' THEN RETURN ''; END IF;
  tokens := regexp_split_to_array(lower(input), '[^a-z]+');
  n := COALESCE(array_length(tokens, 1), 0);

  WHILE i <= n LOOP
    word := tokens[i];
    IF word IS NULL OR word = '' THEN
      i := i + 1; CONTINUE;
    END IF;

    IF tens_map ? word THEN
      cur := (tens_map->word)::int;
      -- Compound: "sixty seven" → 67. Also catches digit-by-digit for
      -- the tens-prefixed case via the mapped value.
      IF i < n AND ones_map ? tokens[i+1] AND (ones_map->tokens[i+1])::int < 10 THEN
        cur := cur + (ones_map->tokens[i+1])::int;
        i := i + 1;
      END IF;
      appended := appended || ' ' || cur::text;
    ELSIF ones_map ? word THEN
      cur := (ones_map->word)::int;
      appended := appended || ' ' || cur::text;
      -- Digit-by-digit pair: "six seven" → 67 (in addition to 6, 7)
      IF cur < 10 AND i < n AND ones_map ? tokens[i+1] AND (ones_map->tokens[i+1])::int < 10 THEN
        appended := appended || ' ' || (cur * 10 + (ones_map->tokens[i+1])::int)::text;
      END IF;
    END IF;
    i := i + 1;
  END LOOP;

  RETURN appended;
END $$;

-- The unified normalizer used at BOTH index time and query time.
-- Lowercases, strips JSON/punct noise, then appends:
--   - word forms of every integer 0..9999 found
--   - digit-by-digit reading for 2-digit numbers ("67" adds "six seven")
--   - digit forms of every number-word phrase
CREATE OR REPLACE FUNCTION search_normalize(input text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  out_text text;
  appended text := '';
  m text[];
  num int;
  ones_w text[] := ARRAY['zero','one','two','three','four','five','six','seven','eight','nine'];
BEGIN
  IF input IS NULL OR input = '' THEN RETURN ''; END IF;
  out_text := lower(input);
  out_text := regexp_replace(out_text, '[^a-z0-9]+', ' ', 'g');
  out_text := regexp_replace(out_text, '\s+', ' ', 'g');
  out_text := trim(out_text);

  FOR m IN SELECT regexp_matches(out_text, '\m\d{1,4}\M', 'g') LOOP
    num := m[1]::int;
    appended := appended || ' ' || search_number_to_words(num);
    IF length(m[1]) = 2 THEN
      appended := appended || ' ' || ones_w[(num/10)+1] || ' ' || ones_w[(num%10)+1];
    END IF;
  END LOOP;

  appended := appended || ' ' || search_words_to_numbers(out_text);

  RETURN trim(regexp_replace(out_text || ' ' || appended, '\s+', ' ', 'g'));
END $$;

-- ------------------------------------------------------------
-- 2. Generated column on files. One column, two indexes.
--    Drop+recreate to make the migration idempotent.
-- ------------------------------------------------------------

DROP INDEX IF EXISTS idx_files_search_text_tsv;
DROP INDEX IF EXISTS idx_files_search_text_trgm;
ALTER TABLE files DROP COLUMN IF EXISTS search_text;

ALTER TABLE files ADD COLUMN search_text text
  GENERATED ALWAYS AS (
    search_normalize(
      COALESCE(file_title, '') || ' ' ||
      COALESCE(file_description, '') || ' ' ||
      COALESCE(metadata->>'description', '') || ' ' ||
      COALESCE(metadata->>'labelNames', '') || ' ' ||
      COALESCE(tags::text, '') || ' ' ||
      COALESCE(categories::text, '') || ' ' ||
      COALESCE(filename, '')
    )
  ) STORED;

CREATE INDEX idx_files_search_text_tsv ON files
  USING gin (to_tsvector('english', search_text));

CREATE INDEX idx_files_search_text_trgm ON files
  USING gin (search_text gin_trgm_ops);

-- ------------------------------------------------------------
-- 3. New search_files RPC. Same return shape as v3 so the app
--    keeps working, but the signature drops p_alt_terms.
-- ------------------------------------------------------------

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
  default_thumbnail text,
  preview_endpoint text,
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
SET pg_trgm.word_similarity_threshold = 0.4
AS $$
DECLARE
  v_norm    text;
  v_tsquery tsquery;
BEGIN
  v_norm := search_normalize(p_query);
  -- websearch_to_tsquery is forgiving of empty input and user syntax.
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
        f.preview_endpoint,
        (SELECT t #>> '{}' FROM unnest(f.thumbnails) AS t
          WHERE (t #>> '{}') LIKE '%thumbnail_preview.jpg' LIMIT 1)
      ) AS default_thumbnail,
      f.preview_endpoint,
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
      word_similarity(v_norm, f.search_text)::float                           AS _wsim,
      word_similarity(v_norm, lower(COALESCE(f.file_title, '')))::float       AS _wsim_title,
      CASE WHEN lower(COALESCE(f.file_title, '')) LIKE '%' || v_norm || '%'
           THEN 1.0 ELSE 0.0 END                                              AS _title_hit
    FROM files f
    LEFT JOIN file_engagement_stats es ON es.file_id = f.id
    LEFT JOIN user_likes    ul ON ul.file_id = f.id
    LEFT JOIN user_dislikes ud ON ud.file_id = f.id
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
        -- word_similarity finds the best-matching WINDOW so short typos like
        -- "avtar" still hit "avatar" inside a long blob.
        OR v_norm <% f.search_text
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
