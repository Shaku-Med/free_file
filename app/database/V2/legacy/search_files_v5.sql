-- ============================================================
-- SEARCH V5: v4 + synonym expansion ("cat" finds "pussy")
-- ============================================================
-- Requires search_files_v4.sql to have run first (search_normalize,
-- files.search_text + its two indexes all stay as-is).
--
-- What's new:
--   1. search_synonyms  editable dictionary of synonym groups. Terms in
--      the same group are interchangeable at QUERY time. Add a row, the
--      next search picks it up  no reindex, no table rewrite.
--   2. search_expand_synonyms()  expands the normalized query tokens
--      into every sibling term of their groups.
--   3. search_files  same signature/return shape as v4, but the match
--      ladder gains an OR branch over the expanded terms, ranked BELOW
--      direct hits so exact matches always win.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Synonym dictionary. Symmetric by construction: every term in a
--    group expands to every other term in that group.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.search_synonyms (
  group_id int  NOT NULL,
  term     text NOT NULL,
  PRIMARY KEY (group_id, term)
);

CREATE INDEX IF NOT EXISTS idx_search_synonyms_term ON public.search_synonyms (term);

ALTER TABLE public.search_synonyms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "search_synonyms_read_all" ON public.search_synonyms;
CREATE POLICY "search_synonyms_read_all" ON public.search_synonyms
  FOR SELECT TO anon, authenticated USING (true);
-- Writes: service_role only (no insert/update/delete policies).

GRANT SELECT ON public.search_synonyms TO anon, authenticated, service_role;

-- Seed groups. Terms are stored normalized (lowercase a-z0-9 + spaces).
-- Re-runnable: ON CONFLICT DO NOTHING. Extend freely from the SQL editor.
INSERT INTO public.search_synonyms (group_id, term) VALUES
  (1,  'cat'), (1, 'cats'), (1, 'kitten'), (1, 'kitty'), (1, 'feline'), (1, 'pussy'), (1, 'pussycat'),
  (2,  'dog'), (2, 'dogs'), (2, 'puppy'), (2, 'pup'), (2, 'doggo'), (2, 'canine'),
  (3,  'car'), (3, 'cars'), (3, 'automobile'), (3, 'vehicle'), (3, 'whip'), (3, 'ride'),
  (4,  'funny'), (4, 'comedy'), (4, 'hilarious'), (4, 'humor'), (4, 'lol'), (4, 'meme'), (4, 'memes'),
  (5,  'music'), (5, 'song'), (5, 'songs'), (5, 'track'), (5, 'tune'), (5, 'audio'),
  (6,  'movie'), (6, 'movies'), (6, 'film'), (6, 'films'), (6, 'cinema'), (6, 'flick'),
  (7,  'football'), (7, 'soccer'),
  (8,  'workout'), (8, 'gym'), (8, 'fitness'), (8, 'exercise'), (8, 'training'),
  (9,  'phone'), (9, 'smartphone'), (9, 'mobile'), (9, 'iphone'), (9, 'android'),
  (10, 'game'), (10, 'games'), (10, 'gaming'), (10, 'gameplay'), (10, 'videogame'),
  (11, 'food'), (11, 'cooking'), (11, 'recipe'), (11, 'meal'), (11, 'dish'), (11, 'eating'),
  (12, 'beautiful'), (12, 'pretty'), (12, 'gorgeous'), (12, 'stunning'), (12, 'cute'),
  (13, 'fast'), (13, 'quick'), (13, 'speed'), (13, 'rapid'),
  (14, 'fight'), (14, 'fighting'), (14, 'boxing'), (14, 'brawl'), (14, 'mma'),
  (15, 'dance'), (15, 'dancing'), (15, 'choreography'), (15, 'choreo'),
  (16, 'baby'), (16, 'infant'), (16, 'toddler'), (16, 'newborn'),
  (17, 'house'), (17, 'home'), (17, 'apartment'), (17, 'crib'),
  (18, 'money'), (18, 'cash'), (18, 'wealth'), (18, 'rich'),
  (19, 'beach'), (19, 'ocean'), (19, 'sea'), (19, 'seaside'),
  (20, 'bike'), (20, 'bicycle'), (20, 'motorcycle'), (20, 'motorbike'),
  (21, 'plane'), (21, 'airplane'), (21, 'aircraft'), (21, 'jet'), (21, 'aviation'),
  (22, 'rap'), (22, 'hiphop'), (22, 'hip hop'), (22, 'rapper'),
  (23, 'makeup'), (23, 'cosmetics'), (23, 'beauty'),
  (24, 'tutorial'), (24, 'howto'), (24, 'how to'), (24, 'guide'), (24, 'lesson'),
  (25, 'scary'), (25, 'horror'), (25, 'creepy'), (25, 'spooky'),
  (26, 'drawing'), (26, 'sketch'), (26, 'illustration'), (26, 'art'),
  (27, 'snow'), (27, 'winter'), (27, 'ski'), (27, 'snowboard'),
  (28, 'rain'), (28, 'storm'), (28, 'thunder'), (28, 'weather'),
  (29, 'cute animals'), (29, 'pets'), (29, 'pet'), (29, 'animal'), (29, 'animals'),
  (30, 'laugh'), (30, 'laughing'), (30, 'laughter'),
  (31, 'kid'), (31, 'kids'), (31, 'children'), (31, 'child'),
  (32, 'sneakers'), (32, 'shoes'), (32, 'kicks'), (32, 'footwear'),
  (33, 'soccer ball'), (33, 'futbol'),
  (34, 'crypto'), (34, 'bitcoin'), (34, 'cryptocurrency'), (34, 'ethereum'),
  (35, 'ai'), (35, 'artificial intelligence'), (35, 'machine learning'), (35, 'chatgpt'),
  (36, 'photography'), (36, 'photo'), (36, 'photos'), (36, 'camera'),
  (37, 'travel'), (37, 'trip'), (37, 'vacation'), (37, 'holiday'), (37, 'tour'),
  (38, 'street'), (38, 'urban'), (38, 'city'),
  (39, 'nature'), (39, 'outdoors'), (39, 'wilderness'), (39, 'forest'),
  (40, 'space'), (40, 'cosmos'), (40, 'universe'), (40, 'astronomy'), (40, 'nasa')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- 2. Expand normalized query tokens into sibling terms.
--    STABLE (reads the table)  query-time only, never indexed.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_expand_synonyms(p_norm text)
RETURNS text[]
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT s2.term), '{}'::text[])
  FROM unnest(regexp_split_to_array(COALESCE(p_norm, ''), '\s+')) AS tok(t)
  JOIN search_synonyms s1 ON s1.term = tok.t
  JOIN search_synonyms s2 ON s2.group_id = s1.group_id AND s2.term <> tok.t;
$$;

-- ------------------------------------------------------------
-- 3. search_files v5  v4 + synonym OR-branch (ranked below direct hits).
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
  v_norm        text;
  v_tsquery     tsquery;
  v_syn_terms   text[];
  v_syn_tsquery tsquery := NULL;
BEGIN
  v_norm := search_normalize(p_query);
  v_tsquery := websearch_to_tsquery('english', v_norm);

  -- Synonym expansion: "cat" also matches docs that only say "pussy".
  -- Terms come from our own dictionary; sanitize anyway and cap at 24 so a
  -- huge group can't blow up the tsquery. Failures just disable the branch.
  BEGIN
    SELECT array_agg(t) INTO v_syn_terms
    FROM (
      SELECT DISTINCT trim(regexp_replace(lower(term), '[^a-z0-9 ]', '', 'g')) AS t
      FROM unnest(search_expand_synonyms(v_norm)) AS term
      LIMIT 24
    ) s
    WHERE t <> '';

    IF v_syn_terms IS NOT NULL AND array_length(v_syn_terms, 1) > 0 THEN
      SELECT to_tsquery('english',
        (SELECT string_agg('(' || replace(t, ' ', ' & ') || ')', ' | ')
         FROM unnest(v_syn_terms) AS t))
      INTO v_syn_tsquery;
      IF numnode(v_syn_tsquery) = 0 THEN
        v_syn_tsquery := NULL;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_syn_tsquery := NULL;
  END;

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
      CASE WHEN v_syn_tsquery IS NOT NULL
           THEN ts_rank_cd(to_tsvector('english', f.search_text), v_syn_tsquery, 32)::float
           ELSE 0.0 END                                                       AS _syn_rank,
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
        OR v_norm <% f.search_text
        -- Synonym branch: doc says "pussy", user typed "cat".
        OR (v_syn_tsquery IS NOT NULL
            AND to_tsvector('english', f.search_text) @@ v_syn_tsquery)
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
          + m._syn_rank     * 4.0
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
