-- ============================================================
-- MIGRATION: fix_feed_series_reference.sql
-- ============================================================
-- Fixes:  get_reel_feed (500) and get_feed failures with
--         "relation public.series does not exist"
--
-- Reason: Both RPCs contained a NOT EXISTS clause against a
--         `public.series` table that does not exist in this
--         schema. The real series model uses:
--           file_series                 (one row per series)
--           files_series_episodes       (episodes under a series)
--           files_series_episode_items  (which files belong to each episode)
--
-- Behaviour: the original clause's intent was "hide files that
--         are series episodes from the public / reel feeds".
--         Correct replacement: NOT EXISTS against
--         files_series_episode_items, joined by the TEXT
--         `unique_id` column (NOT the uuid `id`).
--
-- Run:    Paste this entire file into the Supabase SQL editor
--         and execute. It is idempotent  safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1) get_feed (general feed; reels_only flag optional)
-- ------------------------------------------------------------
-- Drop ALL get_feed overloads first. Older deploys shipped an 8-arg
-- get_feed (…, p_session_cats text[]) whose body still referenced the
-- non-existent public.series table. A static single-signature DROP left
-- that stale overload in place, so /api/feed calls that include
-- p_session_cats resolved to the broken function and 500'd (empty feed).
DO $get_feed_drop$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch, p.proname AS nm, p.oid AS oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'get_feed'
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
$get_feed_drop$;

CREATE OR REPLACE FUNCTION public.get_feed(
  p_user_id       uuid    DEFAULT NULL,
  p_limit         int     DEFAULT 20,
  p_category      text    DEFAULT NULL,
  p_reels_only    boolean DEFAULT false,
  p_seed          text    DEFAULT 'default',
  p_cursor_pos    int     DEFAULT 0,
  p_exclude_ids   uuid[]  DEFAULT '{}'::uuid[],
  p_session_cats  text[]  DEFAULT '{}'::text[]
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
  v_fresh_lim  int;
  v_trend_lim  int;
  v_pop_lim    int;
  v_disc_lim   int;
  v_page_mult  int := 10;
BEGIN
  v_fresh_lim := GREATEST(CEIL(p_limit * 0.30)::int, 1);
  v_trend_lim := GREATEST(CEIL(p_limit * 0.25)::int, 1);
  v_pop_lim   := GREATEST(CEIL(p_limit * 0.20)::int, 1);
  v_disc_lim  := GREATEST(p_limit - v_fresh_lim - v_trend_lim - v_pop_lim, 1);

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
  user_seen AS (
    SELECT fi.file_id FROM feed_impressions fi
    WHERE fi.user_id = p_user_id AND p_user_id IS NOT NULL
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
      f.preview_endpoint,
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
      (us.file_id IS NOT NULL)      AS _is_seen,
      CASE WHEN GREATEST(f.view_count, 1) > 0 THEN
        (COALESCE(es.like_count, 0) + COALESCE(es.comment_count, 0) + f.share_count)::float
        / GREATEST(f.view_count, 1)::float
      ELSE 0.0 END AS _eng_rate,
      (COALESCE(es.like_count, 0) + COALESCE(es.comment_count, 0) + f.share_count + f.view_count)::float
        AS _total_eng,
      EXTRACT(EPOCH FROM (now() - f.created_at)) / 3600.0 AS _hours_old,
      -- Session boost: 1.0 when this file matches a category the viewer has
      -- engaged with this session (passed from in-session likes by /api/feed).
      CASE WHEN p_session_cats IS NOT NULL AND array_length(p_session_cats, 1) > 0
           AND f.categories IS NOT NULL AND jsonb_typeof(f.categories) = 'array'
           AND EXISTS (
             SELECT 1
             FROM jsonb_array_elements_text(COALESCE(f.categories, '[]'::jsonb)) AS fc(cat)
             WHERE fc.cat = ANY(p_session_cats)
           )
      THEN 1.0
      ELSE 0.0 END AS _session_boost,
      (((hashtext(f.id::text || p_seed) % 1000000)::float + 500000.0) / 1000000.0) AS _shuffle
    FROM files f
    LEFT JOIN file_engagement_stats es ON es.file_id = f.id
    LEFT JOIN user_likes ul ON ul.file_id = f.id
    LEFT JOIN user_dislikes ud ON ud.file_id = f.id
    LEFT JOIN user_seen us ON us.file_id = f.id
    WHERE f.is_public = true
      AND f.is_adult = false
      AND f.upload_status = 'complete'
      AND NOT EXISTS (
        -- hide series episodes (real schema: files_series_episode_items, joined by unique_id)
        SELECT 1 FROM public.files_series_episode_items esi
        WHERE esi.file_id = f.unique_id
      )
      AND (p_category IS NULL OR f.categories @> to_jsonb(p_category)::jsonb)
      AND (p_reels_only = false OR f.is_reel = true)
      AND (p_user_id IS NULL OR ud.file_id IS NULL)
      AND (p_exclude_ids = '{}'::uuid[] OR f.id != ALL(p_exclude_ids))
  ),
  pool_fresh AS (
    SELECT b.*, 'fresh'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen THEN 1 ELSE 0 END) ASC,
          b._session_boost * 0.20 + b._shuffle * 0.3 + (1.0 - b._hours_old / 48.0) * 0.7 DESC
      ) AS _rn
    FROM base b
    WHERE b._hours_old <= 48
    LIMIT (v_fresh_lim * v_page_mult) * 2
  ),
  pool_trending AS (
    SELECT b.*, 'trending'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen THEN 1 ELSE 0 END) ASC,
          b._session_boost * 0.20 + b._eng_rate * 0.7 + b._shuffle * 0.3 DESC
      ) AS _rn
    FROM base b
    WHERE b._total_eng >= 3
      AND b.id NOT IN (SELECT pf.id FROM pool_fresh pf WHERE pf._rn <= v_fresh_lim * v_page_mult)
    LIMIT (v_trend_lim * v_page_mult) * 2
  ),
  pool_popular AS (
    SELECT b.*, 'popular'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen THEN 1 ELSE 0 END) ASC,
          LN(GREATEST(b._total_eng, 1)) * 0.6 + b._shuffle * 0.4 DESC
      ) AS _rn
    FROM base b
    WHERE b.id NOT IN (SELECT pf.id FROM pool_fresh pf WHERE pf._rn <= v_fresh_lim * v_page_mult)
      AND b.id NOT IN (SELECT pt.id FROM pool_trending pt WHERE pt._rn <= v_trend_lim * v_page_mult)
    LIMIT (v_pop_lim * v_page_mult) * 2
  ),
  pool_discovery AS (
    SELECT b.*, 'discovery'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen THEN 1 ELSE 0 END) ASC,
          b._shuffle DESC
      ) AS _rn
    FROM base b
    WHERE b.id NOT IN (SELECT pf.id FROM pool_fresh pf WHERE pf._rn <= v_fresh_lim * v_page_mult)
      AND b.id NOT IN (SELECT pt.id FROM pool_trending pt WHERE pt._rn <= v_trend_lim * v_page_mult)
      AND b.id NOT IN (SELECT pp.id FROM pool_popular pp WHERE pp._rn <= v_pop_lim * v_page_mult)
    LIMIT (v_disc_lim * v_page_mult) * 2
  ),
  combined AS (
    SELECT * FROM (SELECT * FROM pool_fresh    WHERE _rn <= v_fresh_lim * v_page_mult) f
    UNION ALL
    SELECT * FROM (SELECT * FROM pool_trending WHERE _rn <= v_trend_lim * v_page_mult) t
    UNION ALL
    SELECT * FROM (SELECT * FROM pool_popular  WHERE _rn <= v_pop_lim * v_page_mult)   p
    UNION ALL
    SELECT * FROM (SELECT * FROM pool_discovery WHERE _rn <= v_disc_lim * v_page_mult) d
  ),
  shuffled AS (
    SELECT c.*,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN c._is_seen THEN 1 ELSE 0 END) ASC,
          (((hashtext(c.id::text || p_seed || c._pool) % 1000000)::float + 500000.0) / 1000000.0) DESC
      ) AS _pre_pos
    FROM combined c
  ),
  -- Per-creator cap (mirrors get_related's max-2/creator rule). Soft cap:
  -- a creator's 3rd+ items aren't dropped, they're spread into later page
  -- groups so one prolific uploader can't flood a single page.
  creator_capped AS (
    SELECT sh.*,
      ROW_NUMBER() OVER (PARTITION BY sh.owner_id ORDER BY sh._pre_pos) AS _creator_rn
    FROM shuffled sh
  ),
  positioned AS (
    SELECT cc.*,
      ROW_NUMBER() OVER (
        ORDER BY
          ((cc._creator_rn - 1) / 2) ASC,  -- creator items 1-2 in group 0, 3-4 in group 1, ...
          cc._pre_pos ASC
      ) AS _final_pos
    FROM creator_capped cc
  )
  SELECT
    s.id,
    s.created_at,
    s.endpoint,
    s.filename,
    s.unique_id,
    s.file_size,
    s.file_type,
    s.is_adult,
    s.owner_id,
    s.is_public,
    s.file_description,
    s.file_title,
    s.default_thumbnail,
    s.preview_endpoint,
    s.view_count,
    s.share_count,
    s.is_reel,
    s.duration,
    s.categories,
    s.tags,
    s.colors,
    s.metadata,
    s._like_count,
    s._dislike_count,
    s._comment_count,
    (s._eng_rate * 30.0 + (1.0 / GREATEST(s._hours_old, 1.0)) * 25.0
     + LN(GREATEST(s._total_eng, 1))::float * 20.0
     + s._shuffle * 5.0)::float AS engagement_score,
    s._pool,
    u.username,
    u.profile_pic,
    u.verified,
    u.about,
    s._user_liked,
    s._user_disliked
  FROM positioned s
  JOIN users u ON u.id = s.owner_id
  WHERE s._final_pos > p_cursor_pos
  ORDER BY s._final_pos ASC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_feed(uuid, int, text, boolean, text, int, uuid[], text[]) TO anon, authenticated;


-- ------------------------------------------------------------
-- 2) get_reel_feed (reels-only; max_duration tuning)
-- ------------------------------------------------------------
-- Drop any overloads cleanly before re-creating.
DO $reel_feed_drop$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch, p.proname AS nm, p.oid AS oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'get_reel_feed'
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
$reel_feed_drop$;

CREATE OR REPLACE FUNCTION public.get_reel_feed(
  p_user_id       uuid    DEFAULT NULL,
  p_limit         int     DEFAULT 15,
  p_category      text    DEFAULT NULL,
  p_seed          text    DEFAULT 'default',
  p_cursor_pos    int     DEFAULT 0,
  p_exclude_ids   uuid[]  DEFAULT '{}'::uuid[],
  p_max_duration  numeric DEFAULT 600.0,
  p_session_cats  text[]  DEFAULT '{}'::text[],
  p_watched_ids   uuid[]  DEFAULT '{}'::uuid[]
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
  owner_username   text,
  owner_profile_pic text,
  owner_verified   boolean,
  owner_about      text,
  user_has_liked   boolean,
  user_has_disliked boolean
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_fresh_lim  int;
  v_trend_lim  int;
  v_pop_lim    int;
  v_disc_lim   int;
  v_page_mult  int := 10;
BEGIN
  v_trend_lim := GREATEST(CEIL(p_limit * 0.40)::int, 1);
  v_fresh_lim := GREATEST(CEIL(p_limit * 0.30)::int, 1);
  v_pop_lim   := GREATEST(CEIL(p_limit * 0.20)::int, 1);
  v_disc_lim  := GREATEST(p_limit - v_fresh_lim - v_trend_lim - v_pop_lim, 1);

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
  user_seen AS (
    SELECT fi.file_id FROM feed_impressions fi
    WHERE fi.user_id = p_user_id AND p_user_id IS NOT NULL
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
      f.preview_endpoint,
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
      (us.file_id IS NOT NULL)      AS _is_seen,
      CASE WHEN GREATEST(f.view_count, 1) > 0 THEN
        (COALESCE(es.like_count, 0) + COALESCE(es.comment_count, 0) + f.share_count)::float
        / GREATEST(f.view_count, 1)::float
      ELSE 0.0 END AS _eng_rate,
      (COALESCE(es.like_count, 0) + COALESCE(es.comment_count, 0) + f.share_count + f.view_count)::float
        AS _total_eng,
      EXTRACT(EPOCH FROM (now() - f.created_at)) / 3600.0 AS _hours_old,
      -- Session boost: matches a category the viewer engaged with this session.
      CASE WHEN p_session_cats IS NOT NULL AND array_length(p_session_cats, 1) > 0
           AND f.categories IS NOT NULL AND jsonb_typeof(f.categories) = 'array'
           AND EXISTS (
             SELECT 1
             FROM jsonb_array_elements_text(COALESCE(f.categories, '[]'::jsonb)) AS fc(cat)
             WHERE fc.cat = ANY(p_session_cats)
           )
      THEN 1.0
      ELSE 0.0 END AS _session_boost,
      -- Recently watched in this session  deprioritize so the reel feed keeps moving.
      (f.id = ANY(p_watched_ids)) AS _recently_watched,
      (((hashtext(f.id::text || p_seed) % 1000000)::float + 500000.0) / 1000000.0) AS _shuffle
    FROM files f
    LEFT JOIN file_engagement_stats es ON es.file_id = f.id
    LEFT JOIN user_likes ul ON ul.file_id = f.id
    LEFT JOIN user_dislikes ud ON ud.file_id = f.id
    LEFT JOIN user_seen us ON us.file_id = f.id
    WHERE f.is_public = true
      AND f.is_adult = false
      AND f.upload_status = 'complete'
      AND NOT EXISTS (
        -- hide series episodes (real schema: files_series_episode_items, joined by unique_id)
        SELECT 1 FROM public.files_series_episode_items esi
        WHERE esi.file_id = f.unique_id
      )
      AND f.is_reel = true
      -- Don't surface the viewer's OWN reels in their feed  people want to
      -- discover other creators, not watch their own clips every time.
      AND (p_user_id IS NULL OR f.owner_id IS DISTINCT FROM p_user_id)
      AND (p_max_duration IS NULL OR f.duration IS NULL OR f.duration <= p_max_duration)
      AND (p_category IS NULL OR f.categories @> to_jsonb(p_category)::jsonb)
      AND (p_user_id IS NULL OR ud.file_id IS NULL)
      AND (p_exclude_ids = '{}'::uuid[] OR f.id != ALL(p_exclude_ids))
  ),
  pool_fresh AS (
    SELECT b.*, 'fresh'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen OR b._recently_watched THEN 1 ELSE 0 END) ASC,
          b._session_boost * 0.20 + b._shuffle * 0.3 + (1.0 - b._hours_old / 48.0) * 0.7 DESC
      ) AS _rn
    FROM base b
    WHERE b._hours_old <= 48
    LIMIT (v_fresh_lim * v_page_mult) * 2
  ),
  pool_trending AS (
    SELECT b.*, 'trending'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen OR b._recently_watched THEN 1 ELSE 0 END) ASC,
          b._session_boost * 0.20 + b._eng_rate * 0.7 + b._shuffle * 0.3 DESC
      ) AS _rn
    FROM base b
    WHERE b._total_eng >= 2
      AND b.id NOT IN (SELECT pf.id FROM pool_fresh pf WHERE pf._rn <= v_fresh_lim * v_page_mult)
    LIMIT (v_trend_lim * v_page_mult) * 2
  ),
  pool_popular AS (
    SELECT b.*, 'popular'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen THEN 1 ELSE 0 END) ASC,
          LN(GREATEST(b._total_eng, 1)) * 0.6 + b._shuffle * 0.4 DESC
      ) AS _rn
    FROM base b
    WHERE b.id NOT IN (SELECT pf.id FROM pool_fresh pf WHERE pf._rn <= v_fresh_lim * v_page_mult)
      AND b.id NOT IN (SELECT pt.id FROM pool_trending pt WHERE pt._rn <= v_trend_lim * v_page_mult)
    LIMIT (v_pop_lim * v_page_mult) * 2
  ),
  pool_discovery AS (
    SELECT b.*, 'discovery'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen THEN 1 ELSE 0 END) ASC,
          b._shuffle DESC
      ) AS _rn
    FROM base b
    WHERE b.id NOT IN (SELECT pf.id FROM pool_fresh pf WHERE pf._rn <= v_fresh_lim * v_page_mult)
      AND b.id NOT IN (SELECT pt.id FROM pool_trending pt WHERE pt._rn <= v_trend_lim * v_page_mult)
      AND b.id NOT IN (SELECT pp.id FROM pool_popular pp WHERE pp._rn <= v_pop_lim * v_page_mult)
    LIMIT (v_disc_lim * v_page_mult) * 2
  ),
  combined AS (
    SELECT * FROM (SELECT * FROM pool_fresh    WHERE _rn <= v_fresh_lim * v_page_mult) f
    UNION ALL
    SELECT * FROM (SELECT * FROM pool_trending WHERE _rn <= v_trend_lim * v_page_mult) t
    UNION ALL
    SELECT * FROM (SELECT * FROM pool_popular  WHERE _rn <= v_pop_lim * v_page_mult)   p
    UNION ALL
    SELECT * FROM (SELECT * FROM pool_discovery WHERE _rn <= v_disc_lim * v_page_mult) d
  ),
  shuffled AS (
    SELECT c.*,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN c._is_seen THEN 1 ELSE 0 END) ASC,
          (((hashtext(c.id::text || p_seed || c._pool) % 1000000)::float + 500000.0) / 1000000.0) DESC
      ) AS _final_pos
    FROM combined c
  )
  SELECT
    s.id,
    s.created_at,
    s.endpoint,
    s.filename,
    s.unique_id,
    s.file_size,
    s.file_type,
    s.is_adult,
    s.owner_id,
    s.is_public,
    s.file_description,
    s.file_title,
    s.default_thumbnail,
    s.preview_endpoint,
    s.view_count,
    s.share_count,
    s.is_reel,
    s.duration,
    s.categories,
    s.tags,
    s.colors,
    s.metadata,
    s._like_count,
    s._dislike_count,
    s._comment_count,
    (s._eng_rate * 30.0 + (1.0 / GREATEST(s._hours_old, 1.0)) * 25.0
     + LN(GREATEST(s._total_eng, 1))::float * 20.0
     + s._shuffle * 5.0)::float AS engagement_score,
    s._pool,
    u.username,
    u.profile_pic,
    u.verified,
    u.about,
    s._user_liked,
    s._user_disliked
  FROM shuffled s
  JOIN users u ON u.id = s.owner_id
  WHERE s._final_pos > p_cursor_pos
  ORDER BY s._final_pos ASC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_reel_feed(uuid, int, text, text, int, uuid[], numeric, text[], uuid[]) TO anon, authenticated;

-- ------------------------------------------------------------
-- 3) Sanity checks (safe to run  they only SELECT)
-- ------------------------------------------------------------
-- Smoke test: should return rows or an empty set, but MUST NOT error.
-- SELECT * FROM public.get_reel_feed(NULL, 5, NULL, 'smoke-' || now()::text) LIMIT 5;
-- SELECT * FROM public.get_feed(NULL, 5, NULL, false, 'smoke-' || now()::text) LIMIT 5;
