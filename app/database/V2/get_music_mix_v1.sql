-- ============================================================
-- MUSIC MIX v1  YouTube-style "radio" seeded from ONE track
-- ============================================================
-- Given a seed file, build an endless, lightly-personalized queue of
-- related tracks. v1 signals (cheap, no new tables):
--   1. Same artist (owner_id == seed.owner_id)            heaviest
--   2. Same sound (shared sound group via original_file_id)
--   3. Category / tag overlap with the seed
--   4. Light personal-taste boost (user_interest_scores)
--   5. Deterministic shuffle (per p_seed) so it varies but is pageable
-- The SEED itself is never returned (the client pins it at the top).
-- Co-listen ("people who played this also played X") is intentionally
-- left for v2.
-- ============================================================

DO $music_mix_drop$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch, p.proname AS nm, p.oid AS oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'get_music_mix'
      AND n.nspname = 'public'
  LOOP
    EXECUTE format(
      'DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE',
      r.sch,
      r.nm,
      pg_get_function_identity_arguments(r.oid)
    );
  END LOOP;
END;
$music_mix_drop$;

CREATE OR REPLACE FUNCTION get_music_mix(
  p_seed_file_id uuid,
  p_user_id      uuid    DEFAULT NULL,
  p_limit        int     DEFAULT 25,
  p_seed         text    DEFAULT 'default',
  p_exclude_ids  uuid[]  DEFAULT '{}'::uuid[]
)
RETURNS TABLE (
  id                 uuid,
  created_at         timestamptz,
  endpoint           text,
  filename           text,
  unique_id          text,
  file_size          text,
  file_type          text,
  is_adult           boolean,
  owner_id           uuid,
  is_public          boolean,
  file_description   text,
  file_title         text,
  default_thumbnail  text,
  view_count         numeric,
  share_count        numeric,
  is_reel            boolean,
  duration           numeric,
  categories         jsonb,
  tags               jsonb,
  colors             jsonb,
  metadata           jsonb,
  like_count         bigint,
  dislike_count      bigint,
  comment_count      bigint,
  original_file_id   uuid,
  mix_reason         text,
  mix_score          float,
  owner_username     text,
  owner_profile_pic  text,
  owner_verified     boolean,
  user_has_liked     boolean,
  user_has_disliked  boolean
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_owner   uuid;
  v_group   uuid;          -- sound group = COALESCE(original_file_id, id)
  v_cats    jsonb;
  v_tags    jsonb;
  v_cat_arr text[];
  v_tag_arr text[];
BEGIN
  -- Resolve the seed's identity + content signals.
  SELECT
    f.owner_id,
    COALESCE(f.original_file_id, f.id),
    f.categories,
    f.tags
  INTO v_owner, v_group, v_cats, v_tags
  FROM files f
  WHERE f.id = p_seed_file_id;

  IF v_owner IS NULL AND v_group IS NULL THEN
    RETURN; -- unknown / missing seed
  END IF;

  v_cat_arr := CASE WHEN v_cats IS NOT NULL AND jsonb_typeof(v_cats) = 'array'
                    THEN ARRAY(SELECT jsonb_array_elements_text(v_cats)) ELSE '{}'::text[] END;
  v_tag_arr := CASE WHEN v_tags IS NOT NULL AND jsonb_typeof(v_tags) = 'array'
                    THEN ARRAY(SELECT jsonb_array_elements_text(v_tags)) ELSE '{}'::text[] END;

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
  user_interests AS (
    SELECT uis.category, uis.score AS interest_score
    FROM user_interest_scores uis
    WHERE uis.user_id = p_user_id AND p_user_id IS NOT NULL
    ORDER BY uis.score DESC
    LIMIT 20
  ),
  cand AS (
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
      f.duration,
      f.categories,
      f.tags,
      f.colors,
      f.metadata,
      f.original_file_id,
      COALESCE(es.like_count, 0)    AS _like_count,
      COALESCE(es.dislike_count, 0) AS _dislike_count,
      COALESCE(es.comment_count, 0) AS _comment_count,
      (ul.file_id IS NOT NULL)      AS _user_liked,
      (ud.file_id IS NOT NULL)      AS _user_disliked,

      (f.owner_id = v_owner)                              AS _same_artist,
      (COALESCE(f.original_file_id, f.id) = v_group)      AS _same_sound,

      -- # of shared categories + shared tags with the seed
      (
        (SELECT count(*) FROM (
            SELECT jsonb_array_elements_text(COALESCE(f.categories, '[]'::jsonb))
            INTERSECT
            SELECT unnest(v_cat_arr)
          ) AS cc)
        +
        (SELECT count(*) FROM (
            SELECT jsonb_array_elements_text(COALESCE(f.tags, '[]'::jsonb))
            INTERSECT
            SELECT unnest(v_tag_arr)
          ) AS tt)
      )::int AS _overlap,

      COALESCE((
        SELECT SUM(ui.interest_score)::float
        FROM user_interests ui
        WHERE f.categories IS NOT NULL
          AND jsonb_typeof(f.categories) = 'array'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(f.categories) AS fc(cat)
            WHERE fc.cat = ui.category
          )
      ), 0.0) AS _interest,

      (((hashtext(f.id::text || p_seed) % 1000000)::float + 500000.0) / 1000000.0) AS _shuffle
    FROM files f
    LEFT JOIN file_engagement_stats es ON es.file_id = f.id
    LEFT JOIN user_likes ul ON ul.file_id = f.id
    LEFT JOIN user_dislikes ud ON ud.file_id = f.id
    WHERE f.is_public = true
      AND f.is_adult = false
      AND f.upload_status = 'complete'
      AND f.id <> p_seed_file_id
      AND NOT (f.id = ANY(p_exclude_ids))
      AND NOT EXISTS (
        SELECT 1 FROM public.files_series_episode_items esi
        WHERE esi.file_id = f.unique_id
      )
      -- Candidate pool: same artist, same sound, or shares a category / tag.
      AND (
        f.owner_id = v_owner
        OR COALESCE(f.original_file_id, f.id) = v_group
        OR (cardinality(v_cat_arr) > 0 AND f.categories ?| v_cat_arr)
        OR (cardinality(v_tag_arr) > 0 AND f.tags ?| v_tag_arr)
      )
  ),
  ranked AS (
    SELECT c.*,
      (
        (CASE WHEN c._same_artist THEN 0.40 ELSE 0.0 END)
        + (CASE WHEN c._same_sound THEN 0.30 ELSE 0.0 END)
        + LEAST(c._overlap::float / 4.0, 0.20)
        + LEAST(c._interest / 15.0, 0.10)
        + c._shuffle * 0.15
      )::float AS _score,
      CASE
        WHEN c._same_sound  THEN 'sound'
        WHEN c._same_artist THEN 'artist'
        ELSE 'related'
      END AS _reason
    FROM cand c
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
    r.duration,
    r.categories,
    r.tags,
    r.colors,
    r.metadata,
    r._like_count,
    r._dislike_count,
    r._comment_count,
    r.original_file_id,
    r._reason,
    r._score,
    u.username,
    u.profile_pic,
    u.verified,
    r._user_liked,
    r._user_disliked
  FROM ranked r
  JOIN users u ON u.id = r.owner_id
  ORDER BY r._score DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_music_mix(uuid, uuid, int, text, uuid[]) TO anon, authenticated;
