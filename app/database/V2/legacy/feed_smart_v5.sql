-- ============================================================
-- FEED v5.0  Phase 1 Smart Recommendation Engine
-- ============================================================
-- Reel strips: `feed_reel_cluster_id` is assigned per response page so that
-- consecutive `is_reel` rows share one id; non-reels each get a unique id.
-- Use in the app with `groupConsecutiveReelClusters` (horizontal VideoCard row).
-- ============================================================
-- Upgrades:
--   1. Subscription boost  content from followed channels ranks higher
--   2. Category affinity  boost categories user has liked before
--   3. Like ratio signal  files with high like-to-dislike ratio rank higher
--   4. Engagement velocity  fast-growing content gets boosted
--   5. New "subscribed" pool  15% of feed from subscriptions
--   6. Exponential recency decay instead of linear
--   7. Materialized view refresh helper
-- ============================================================
-- Run in Supabase SQL Editor. Replaces get_feed, get_reel_feed, get_related.
-- Feed visibility: exclude episode-only files (is_files_series_item without is_series_main).
-- Storage: files.github_repo is server-only  never add f.github_repo to SELECT / RETURNS here.
-- ============================================================


-- ============================================================
-- HELPER: Refresh file_engagement_stats materialized view
-- Call this on a cron (e.g. every 5 minutes) or after bulk writes
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_engagement_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY file_engagement_stats;
EXCEPTION WHEN OTHERS THEN
  -- If CONCURRENTLY fails (no unique index), fall back to blocking refresh
  REFRESH MATERIALIZED VIEW file_engagement_stats;
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_engagement_stats() TO authenticated;


-- ============================================================
-- MAIN FEED v5  Smart personalized feed
-- ============================================================
DROP FUNCTION IF EXISTS get_feed;

CREATE OR REPLACE FUNCTION get_feed(
  p_user_id       uuid    DEFAULT NULL,
  p_limit         int     DEFAULT 20,
  p_category      text    DEFAULT NULL,
  p_reels_only    boolean DEFAULT false,
  p_seed          text    DEFAULT 'default',
  p_cursor_pos    int     DEFAULT 0,
  p_exclude_ids   uuid[]  DEFAULT '{}'::uuid[]
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
  captions         jsonb,
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
  user_has_disliked boolean,
  feed_reel_cluster_id bigint
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_fresh_lim  int;
  v_trend_lim  int;
  v_pop_lim    int;
  v_sub_lim    int;
  v_disc_lim   int;
  v_page_mult  int := 10;
  v_has_subs   boolean := false;
BEGIN
  -- Check if user has subscriptions (to decide pool allocation)
  IF p_user_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM subscriptions WHERE subscriber_id = p_user_id LIMIT 1
    ) INTO v_has_subs;
  END IF;

  -- Pool allocation: adjust based on whether user has subscriptions
  IF v_has_subs THEN
    -- Logged in with subscriptions: fresh 25%, trending 20%, popular 15%, subscribed 15%, discovery 25%
    v_fresh_lim := GREATEST(CEIL(p_limit * 0.25)::int, 1);
    v_trend_lim := GREATEST(CEIL(p_limit * 0.20)::int, 1);
    v_pop_lim   := GREATEST(CEIL(p_limit * 0.15)::int, 1);
    v_sub_lim   := GREATEST(CEIL(p_limit * 0.15)::int, 1);
    v_disc_lim  := GREATEST(p_limit - v_fresh_lim - v_trend_lim - v_pop_lim - v_sub_lim, 1);
  ELSE
    -- Anonymous or no subscriptions: original split (no sub pool)
    v_fresh_lim := GREATEST(CEIL(p_limit * 0.30)::int, 1);
    v_trend_lim := GREATEST(CEIL(p_limit * 0.25)::int, 1);
    v_pop_lim   := GREATEST(CEIL(p_limit * 0.20)::int, 1);
    v_sub_lim   := 0;
    v_disc_lim  := GREATEST(p_limit - v_fresh_lim - v_trend_lim - v_pop_lim, 1);
  END IF;

  RETURN QUERY
  WITH
  -- User's liked files (for like status + category affinity)
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

  -- Subscribed channels
  sub_channels AS (
    SELECT s.channel_id FROM subscriptions s
    WHERE s.subscriber_id = p_user_id AND p_user_id IS NOT NULL
  ),

  -- Category affinity: categories the user has liked content in (top 10)
  user_cat_affinity AS (
    SELECT cat.value AS category, COUNT(*) AS affinity_score
    FROM likes l
    JOIN files f ON f.id = l.file_id
    CROSS JOIN LATERAL jsonb_array_elements_text(f.categories) AS cat(value)
    WHERE l.user_id = p_user_id
      AND p_user_id IS NOT NULL
      AND f.categories IS NOT NULL
      AND jsonb_typeof(f.categories) = 'array'
    GROUP BY cat.value
    ORDER BY COUNT(*) DESC
    LIMIT 10
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
      f.is_series_main,
      f.is_files_series_item,
      f.file_series_id,
      f.file_series_episode_id,
      f.duration,
      f.categories,
      f.tags,
      f.colors,
      f.metadata,
      f.captions,
      COALESCE(es.like_count, 0)    AS _like_count,
      COALESCE(es.dislike_count, 0) AS _dislike_count,
      COALESCE(es.comment_count, 0) AS _comment_count,
      (ul.file_id IS NOT NULL)      AS _user_liked,
      (ud.file_id IS NOT NULL)      AS _user_disliked,
      (us.file_id IS NOT NULL)      AS _is_seen,
      (sc.channel_id IS NOT NULL)   AS _is_subscribed,

      -- Engagement rate (likes + comments + shares / views)
      CASE WHEN GREATEST(f.view_count, 1) > 0 THEN
        (COALESCE(es.like_count, 0) + COALESCE(es.comment_count, 0) + f.share_count)::float
        / GREATEST(f.view_count, 1)::float
      ELSE 0.0 END AS _eng_rate,

      -- Total engagement raw number
      (COALESCE(es.like_count, 0) + COALESCE(es.comment_count, 0) + f.share_count + f.view_count)::float
        AS _total_eng,

      -- Like ratio: likes / (likes + dislikes). High ratio = quality content
      CASE WHEN (COALESCE(es.like_count, 0) + COALESCE(es.dislike_count, 0)) > 0 THEN
        COALESCE(es.like_count, 0)::float / (COALESCE(es.like_count, 0) + COALESCE(es.dislike_count, 0))::float
      ELSE 0.5 END AS _like_ratio,

      -- Engagement velocity: engagement per hour (rewards fast-growing content)
      CASE WHEN EXTRACT(EPOCH FROM (now() - f.created_at)) > 0 THEN
        (COALESCE(es.like_count, 0) + COALESCE(es.comment_count, 0) + f.share_count)::float
        / GREATEST(EXTRACT(EPOCH FROM (now() - f.created_at)) / 3600.0, 1.0)
      ELSE 0.0 END AS _eng_velocity,

      -- Hours old
      EXTRACT(EPOCH FROM (now() - f.created_at)) / 3600.0 AS _hours_old,

      -- Category affinity boost: sum of affinity scores for matching categories
      COALESCE((
        SELECT SUM(uca.affinity_score)::float
        FROM user_cat_affinity uca
        WHERE f.categories IS NOT NULL
          AND jsonb_typeof(f.categories) = 'array'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(COALESCE(f.categories, '[]'::jsonb)) AS fc(cat)
            WHERE fc.cat = uca.category
          )
      ), 0.0) AS _cat_affinity,

      -- Deterministic shuffle
      (((hashtext(f.id::text || p_seed) % 1000000)::float + 500000.0) / 1000000.0) AS _shuffle

    FROM files f
    LEFT JOIN file_engagement_stats es ON es.file_id = f.id
    LEFT JOIN user_likes ul ON ul.file_id = f.id
    LEFT JOIN user_dislikes ud ON ud.file_id = f.id
    LEFT JOIN user_seen us ON us.file_id = f.id
    LEFT JOIN sub_channels sc ON sc.channel_id = f.owner_id
    WHERE f.is_public = true
      AND f.is_adult = false
      AND f.upload_status = 'complete'
      AND (f.is_series_main OR COALESCE(f.is_files_series_item, false) IS NOT TRUE)
      AND (p_category IS NULL OR f.categories @> to_jsonb(p_category)::jsonb)
      AND (p_reels_only = false OR f.is_reel = true)
      AND (p_user_id IS NULL OR ud.file_id IS NULL)   -- exclude disliked
      AND (p_exclude_ids = '{}'::uuid[] OR f.id != ALL(p_exclude_ids))
  ),

  -- ── Pool 1: FRESH  new content (last 48h)
  pool_fresh AS (
    SELECT b.*, 'fresh'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen THEN 1 ELSE 0 END) ASC,
          -- Blend: recency + subscription boost + category affinity + shuffle
          (1.0 - LEAST(b._hours_old / 48.0, 1.0)) * 0.40
          + (CASE WHEN b._is_subscribed THEN 0.25 ELSE 0.0 END)
          + LEAST(b._cat_affinity / 10.0, 0.15)
          + b._shuffle * 0.20
          DESC
      ) AS _rn
    FROM base b
    WHERE b._hours_old <= 48
    LIMIT (v_fresh_lim * v_page_mult) * 2
  ),

  -- ── Pool 2: TRENDING  high engagement velocity
  pool_trending AS (
    SELECT b.*, 'trending'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen THEN 1 ELSE 0 END) ASC,
          -- Blend: velocity + like ratio + subscription boost + shuffle
          LEAST(b._eng_velocity / 10.0, 1.0) * 0.35
          + b._like_ratio * 0.20
          + b._eng_rate * 0.15
          + (CASE WHEN b._is_subscribed THEN 0.15 ELSE 0.0 END)
          + b._shuffle * 0.15
          DESC
      ) AS _rn
    FROM base b
    WHERE b._total_eng >= 3
      AND b.id NOT IN (SELECT pf.id FROM pool_fresh pf WHERE pf._rn <= v_fresh_lim * v_page_mult)
    LIMIT (v_trend_lim * v_page_mult) * 2
  ),

  -- ── Pool 3: POPULAR  high total engagement, good ratio
  pool_popular AS (
    SELECT b.*, 'popular'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen THEN 1 ELSE 0 END) ASC,
          -- Blend: total engagement + like ratio + category affinity + shuffle
          LN(GREATEST(b._total_eng, 1)) * 0.35
          + b._like_ratio * 0.20
          + LEAST(b._cat_affinity / 10.0, 0.15)
          + (CASE WHEN b._is_subscribed THEN 0.10 ELSE 0.0 END)
          + b._shuffle * 0.20
          DESC
      ) AS _rn
    FROM base b
    WHERE b.id NOT IN (SELECT pf.id FROM pool_fresh pf WHERE pf._rn <= v_fresh_lim * v_page_mult)
      AND b.id NOT IN (SELECT pt.id FROM pool_trending pt WHERE pt._rn <= v_trend_lim * v_page_mult)
    LIMIT (v_pop_lim * v_page_mult) * 2
  ),

  -- ── Pool 4: SUBSCRIBED  content from followed channels (newest first)
  pool_subscribed AS (
    SELECT b.*, 'subscribed'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen THEN 1 ELSE 0 END) ASC,
          b.created_at DESC
      ) AS _rn
    FROM base b
    WHERE b._is_subscribed = true
      AND b.id NOT IN (SELECT pf.id FROM pool_fresh pf WHERE pf._rn <= v_fresh_lim * v_page_mult)
      AND b.id NOT IN (SELECT pt.id FROM pool_trending pt WHERE pt._rn <= v_trend_lim * v_page_mult)
      AND b.id NOT IN (SELECT pp.id FROM pool_popular pp WHERE pp._rn <= v_pop_lim * v_page_mult)
    LIMIT (v_sub_lim * v_page_mult) * 2
  ),

  -- ── Pool 5: DISCOVERY  diverse content the user hasn't seen
  pool_discovery AS (
    SELECT b.*, 'discovery'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen THEN 1 ELSE 0 END) ASC,
          -- Slight category affinity boost even in discovery, mostly random
          LEAST(b._cat_affinity / 20.0, 0.10) + b._shuffle * 0.90
          DESC
      ) AS _rn
    FROM base b
    WHERE b.id NOT IN (SELECT pf.id FROM pool_fresh pf WHERE pf._rn <= v_fresh_lim * v_page_mult)
      AND b.id NOT IN (SELECT pt.id FROM pool_trending pt WHERE pt._rn <= v_trend_lim * v_page_mult)
      AND b.id NOT IN (SELECT pp.id FROM pool_popular pp WHERE pp._rn <= v_pop_lim * v_page_mult)
      AND (v_sub_lim = 0 OR b.id NOT IN (SELECT ps.id FROM pool_subscribed ps WHERE ps._rn <= v_sub_lim * v_page_mult))
    LIMIT (v_disc_lim * v_page_mult) * 2
  ),

  combined AS (
    SELECT * FROM (SELECT * FROM pool_fresh      WHERE _rn <= v_fresh_lim * v_page_mult) f
    UNION ALL
    SELECT * FROM (SELECT * FROM pool_trending   WHERE _rn <= v_trend_lim * v_page_mult) t
    UNION ALL
    SELECT * FROM (SELECT * FROM pool_popular    WHERE _rn <= v_pop_lim * v_page_mult)   p
    UNION ALL
    SELECT * FROM (SELECT * FROM pool_subscribed WHERE _rn <= v_sub_lim * v_page_mult)   s
    UNION ALL
    SELECT * FROM (SELECT * FROM pool_discovery  WHERE _rn <= v_disc_lim * v_page_mult)  d
  ),

  shuffled AS (
    SELECT c.*,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN c._is_seen THEN 1 ELSE 0 END) ASC,
          -- Final shuffle keeps pool diversity but with smart ordering
          (CASE WHEN c._is_subscribed AND NOT c._is_seen THEN 0.15 ELSE 0.0 END)
          + LEAST(c._cat_affinity / 20.0, 0.10)
          + (((hashtext(c.id::text || p_seed || c._pool) % 1000000)::float + 500000.0) / 1000000.0) * 0.75
          DESC
      ) AS _final_pos
    FROM combined c
  ),

  _feed_page AS (
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
      s.view_count,
      s.share_count,
      s.is_reel,
    s.is_series_main,
    s.is_files_series_item,
    s.file_series_id,
    s.file_series_episode_id,
      s.duration,
      s.categories,
      s.tags,
      s.colors,
      s.metadata,
      s.captions,
      s._like_count,
      s._dislike_count,
      s._comment_count,
      (
        LEAST(s._eng_velocity / 5.0, 1.0) * 25.0
        + s._like_ratio * 20.0
        + EXP(-s._hours_old / 168.0)::float * 20.0
        + LN(GREATEST(s._total_eng, 1))::float * 15.0
        + LEAST(s._cat_affinity / 5.0, 10.0)
        + (CASE WHEN s._is_subscribed THEN 10.0 ELSE 0.0 END)
      )::float AS engagement_score,
      s._pool,
      u.username,
      u.profile_pic,
      u.verified,
      u.about,
      s._user_liked,
      s._user_disliked,
      s._final_pos
    FROM shuffled s
    JOIN users u ON u.id = s.owner_id
    WHERE s._final_pos > p_cursor_pos
    ORDER BY s._final_pos ASC
    LIMIT p_limit
  ),
  _feed_marked AS (
    SELECT
      fp.*,
      CASE
        WHEN COALESCE(fp.is_reel, false) IS NOT TRUE THEN fp._final_pos
        WHEN NOT COALESCE(LAG(fp.is_reel) OVER (ORDER BY fp._final_pos), false) THEN fp._final_pos
        ELSE NULL
      END AS _cluster_start
    FROM _feed_page fp
  ),
  _feed_clustered AS (
    SELECT
      fm.*,
      MAX(fm._cluster_start) OVER (
        ORDER BY fm._final_pos ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS feed_reel_cluster_id
    FROM _feed_marked fm
  )

  SELECT
    fc.id,
    fc.created_at,
    fc.endpoint,
    fc.filename,
    fc.unique_id,
    fc.file_size,
    fc.file_type,
    fc.is_adult,
    fc.owner_id,
    fc.is_public,
    fc.file_description,
    fc.file_title,
    fc.default_thumbnail,
    fc.view_count,
    fc.share_count,
    fc.is_reel,
    fc.is_series_main,
    fc.is_files_series_item,
    fc.file_series_id,
    fc.file_series_episode_id,
    fc.duration,
    fc.categories,
    fc.tags,
    fc.colors,
    fc.metadata,
    fc.captions,
    fc._like_count,
    fc._dislike_count,
    fc._comment_count,
    fc.engagement_score,
    fc._pool,
    fc.username,
    fc.profile_pic,
    fc.verified,
    fc.about,
    fc._user_liked,
    fc._user_disliked,
    fc.feed_reel_cluster_id
  FROM _feed_clustered fc
  ORDER BY fc._final_pos ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_feed TO anon, authenticated;


-- ============================================================
-- REEL FEED v5  Smart reel feed with same improvements
-- ============================================================
-- PG cannot CREATE OR REPLACE when RETURNS TABLE columns change; drop every overload first
-- (e.g. legacy 6-arg without p_max_duration, or older OUT set without feed_reel_cluster_id).
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

CREATE OR REPLACE FUNCTION get_reel_feed(
  p_user_id       uuid    DEFAULT NULL,
  p_limit         int     DEFAULT 15,
  p_category      text    DEFAULT NULL,
  p_seed          text    DEFAULT 'default',
  p_cursor_pos    int     DEFAULT 0,
  p_exclude_ids   uuid[]  DEFAULT '{}'::uuid[],
  p_max_duration  numeric DEFAULT 600.0
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
  captions         jsonb,
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
  user_has_disliked boolean,
  feed_reel_cluster_id bigint
)
LANGUAGE plpgsql
STABLE
AS $$
  -- Pagination: pass p_exclude_ids plus a new p_seed each fetch (p_cursor_pos ignored).
DECLARE
  v_fresh_lim  int;
  v_trend_lim  int;
  v_pop_lim    int;
  v_sub_lim    int;
  v_disc_lim   int;
  v_page_mult  int := 10;
  v_has_subs   boolean := false;
BEGIN
  IF p_user_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM subscriptions WHERE subscriber_id = p_user_id LIMIT 1
    ) INTO v_has_subs;
  END IF;

  -- Reel mix: more trending. With subs: trend 30%, fresh 25%, sub 15%, pop 15%, disc 15%
  IF v_has_subs THEN
    v_trend_lim := GREATEST(CEIL(p_limit * 0.30)::int, 1);
    v_fresh_lim := GREATEST(CEIL(p_limit * 0.25)::int, 1);
    v_sub_lim   := GREATEST(CEIL(p_limit * 0.15)::int, 1);
    v_pop_lim   := GREATEST(CEIL(p_limit * 0.15)::int, 1);
    v_disc_lim  := GREATEST(p_limit - v_fresh_lim - v_trend_lim - v_sub_lim - v_pop_lim, 1);
  ELSE
    v_trend_lim := GREATEST(CEIL(p_limit * 0.40)::int, 1);
    v_fresh_lim := GREATEST(CEIL(p_limit * 0.30)::int, 1);
    v_pop_lim   := GREATEST(CEIL(p_limit * 0.20)::int, 1);
    v_sub_lim   := 0;
    v_disc_lim  := GREATEST(p_limit - v_fresh_lim - v_trend_lim - v_pop_lim, 1);
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
  user_seen AS (
    SELECT fi.file_id FROM feed_impressions fi
    WHERE fi.user_id = p_user_id AND p_user_id IS NOT NULL
  ),
  sub_channels AS (
    SELECT s.channel_id FROM subscriptions s
    WHERE s.subscriber_id = p_user_id AND p_user_id IS NOT NULL
  ),
  user_cat_affinity AS (
    SELECT cat.value AS category, COUNT(*) AS affinity_score
    FROM likes l
    JOIN files f ON f.id = l.file_id
    CROSS JOIN LATERAL jsonb_array_elements_text(f.categories) AS cat(value)
    WHERE l.user_id = p_user_id
      AND p_user_id IS NOT NULL
      AND f.categories IS NOT NULL
      AND jsonb_typeof(f.categories) = 'array'
    GROUP BY cat.value
    ORDER BY COUNT(*) DESC
    LIMIT 10
  ),
  base AS (
    SELECT
      f.id, f.created_at, f.endpoint, f.filename, f.unique_id,
      f.file_size, f.file_type, f.is_adult, f.owner_id, f.is_public,
      f.file_description, f.file_title, COALESCE(f.default_thumbnail, (SELECT t #>> '{}' FROM unnest(f.thumbnails) AS t WHERE (t #>> '{}') LIKE '%thumbnail_preview.jpg' LIMIT 1)) AS default_thumbnail, f.view_count,
      f.share_count, f.is_reel, f.duration, f.categories, f.tags,
      f.colors, f.metadata, f.captions,
      COALESCE(es.like_count, 0)    AS _like_count,
      COALESCE(es.dislike_count, 0) AS _dislike_count,
      COALESCE(es.comment_count, 0) AS _comment_count,
      (ul.file_id IS NOT NULL)      AS _user_liked,
      (ud.file_id IS NOT NULL)      AS _user_disliked,
      (us.file_id IS NOT NULL)      AS _is_seen,
      (sc.channel_id IS NOT NULL)   AS _is_subscribed,
      CASE WHEN GREATEST(f.view_count, 1) > 0 THEN
        (COALESCE(es.like_count, 0) + COALESCE(es.comment_count, 0) + f.share_count)::float
        / GREATEST(f.view_count, 1)::float
      ELSE 0.0 END AS _eng_rate,
      (COALESCE(es.like_count, 0) + COALESCE(es.comment_count, 0) + f.share_count + f.view_count)::float AS _total_eng,
      CASE WHEN (COALESCE(es.like_count, 0) + COALESCE(es.dislike_count, 0)) > 0 THEN
        COALESCE(es.like_count, 0)::float / (COALESCE(es.like_count, 0) + COALESCE(es.dislike_count, 0))::float
      ELSE 0.5 END AS _like_ratio,
      CASE WHEN EXTRACT(EPOCH FROM (now() - f.created_at)) > 0 THEN
        (COALESCE(es.like_count, 0) + COALESCE(es.comment_count, 0) + f.share_count)::float
        / GREATEST(EXTRACT(EPOCH FROM (now() - f.created_at)) / 3600.0, 1.0)
      ELSE 0.0 END AS _eng_velocity,
      EXTRACT(EPOCH FROM (now() - f.created_at)) / 3600.0 AS _hours_old,
      COALESCE((
        SELECT SUM(uca.affinity_score)::float
        FROM user_cat_affinity uca
        WHERE f.categories IS NOT NULL
          AND jsonb_typeof(f.categories) = 'array'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(COALESCE(f.categories, '[]'::jsonb)) AS fc(cat)
            WHERE fc.cat = uca.category
          )
      ), 0.0) AS _cat_affinity,
      (((hashtext(f.id::text || p_seed) % 1000000)::float + 500000.0) / 1000000.0) AS _shuffle
    FROM files f
    LEFT JOIN file_engagement_stats es ON es.file_id = f.id
    LEFT JOIN user_likes ul ON ul.file_id = f.id
    LEFT JOIN user_dislikes ud ON ud.file_id = f.id
    LEFT JOIN user_seen us ON us.file_id = f.id
    LEFT JOIN sub_channels sc ON sc.channel_id = f.owner_id
    WHERE f.is_public = true
      AND f.is_adult = false
      AND f.upload_status = 'complete'
      -- Hide series episodes via real schema (never use legacy public.series  table does not exist).
      AND NOT EXISTS (
        SELECT 1 FROM public.files_series_episode_items esi
        WHERE esi.file_id = f.unique_id
      )
      AND f.is_reel = true
      AND (p_max_duration IS NULL OR f.duration IS NULL OR f.duration <= p_max_duration)
      AND (p_category IS NULL OR f.categories @> to_jsonb(p_category)::jsonb)
      AND (p_user_id IS NULL OR ud.file_id IS NULL)
      AND (p_exclude_ids = '{}'::uuid[] OR f.id != ALL(p_exclude_ids))
  ),
  pool_fresh AS (
    SELECT b.*, 'fresh'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen THEN 1 ELSE 0 END) ASC,
          (1.0 - LEAST(b._hours_old / 48.0, 1.0)) * 0.40
          + (CASE WHEN b._is_subscribed THEN 0.25 ELSE 0.0 END)
          + LEAST(b._cat_affinity / 10.0, 0.15)
          + b._shuffle * 0.20
          DESC
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
          LEAST(b._eng_velocity / 10.0, 1.0) * 0.35
          + b._like_ratio * 0.20
          + b._eng_rate * 0.15
          + (CASE WHEN b._is_subscribed THEN 0.15 ELSE 0.0 END)
          + b._shuffle * 0.15
          DESC
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
          LN(GREATEST(b._total_eng, 1)) * 0.35
          + b._like_ratio * 0.20
          + LEAST(b._cat_affinity / 10.0, 0.15)
          + (CASE WHEN b._is_subscribed THEN 0.10 ELSE 0.0 END)
          + b._shuffle * 0.20
          DESC
      ) AS _rn
    FROM base b
    WHERE b.id NOT IN (SELECT pf.id FROM pool_fresh pf WHERE pf._rn <= v_fresh_lim * v_page_mult)
      AND b.id NOT IN (SELECT pt.id FROM pool_trending pt WHERE pt._rn <= v_trend_lim * v_page_mult)
    LIMIT (v_pop_lim * v_page_mult) * 2
  ),
  pool_subscribed AS (
    SELECT b.*, 'subscribed'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen THEN 1 ELSE 0 END) ASC,
          b.created_at DESC
      ) AS _rn
    FROM base b
    WHERE b._is_subscribed = true
      AND b.id NOT IN (SELECT pf.id FROM pool_fresh pf WHERE pf._rn <= v_fresh_lim * v_page_mult)
      AND b.id NOT IN (SELECT pt.id FROM pool_trending pt WHERE pt._rn <= v_trend_lim * v_page_mult)
      AND b.id NOT IN (SELECT pp.id FROM pool_popular pp WHERE pp._rn <= v_pop_lim * v_page_mult)
    LIMIT (v_sub_lim * v_page_mult) * 2
  ),
  pool_discovery AS (
    SELECT b.*, 'discovery'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen THEN 1 ELSE 0 END) ASC,
          LEAST(b._cat_affinity / 20.0, 0.10) + b._shuffle * 0.90
          DESC
      ) AS _rn
    FROM base b
    WHERE b.id NOT IN (SELECT pf.id FROM pool_fresh pf WHERE pf._rn <= v_fresh_lim * v_page_mult)
      AND b.id NOT IN (SELECT pt.id FROM pool_trending pt WHERE pt._rn <= v_trend_lim * v_page_mult)
      AND b.id NOT IN (SELECT pp.id FROM pool_popular pp WHERE pp._rn <= v_pop_lim * v_page_mult)
      AND (v_sub_lim = 0 OR b.id NOT IN (SELECT ps.id FROM pool_subscribed ps WHERE ps._rn <= v_sub_lim * v_page_mult))
    LIMIT (v_disc_lim * v_page_mult) * 2
  ),
  combined AS (
    SELECT * FROM (SELECT * FROM pool_fresh      WHERE _rn <= v_fresh_lim * v_page_mult) f
    UNION ALL
    SELECT * FROM (SELECT * FROM pool_trending   WHERE _rn <= v_trend_lim * v_page_mult) t
    UNION ALL
    SELECT * FROM (SELECT * FROM pool_popular    WHERE _rn <= v_pop_lim * v_page_mult)   p
    UNION ALL
    SELECT * FROM (SELECT * FROM pool_subscribed WHERE _rn <= v_sub_lim * v_page_mult)   s
    UNION ALL
    SELECT * FROM (SELECT * FROM pool_discovery  WHERE _rn <= v_disc_lim * v_page_mult)  d
  ),
  shuffled AS (
    SELECT c.*,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN c._is_seen THEN 1 ELSE 0 END) ASC,
          -- Strong per-seed variance (new seed each client fetch) like get_pip_feed; light quality signals.
          (CASE WHEN c._is_subscribed AND NOT c._is_seen THEN 0.06 ELSE 0.0 END)
          + LEAST(c._cat_affinity / 25.0, 0.06)
          + (((hashtext(c.id::text || p_seed || c._pool) % 1000000)::float + 500000.0) / 1000000.0) * 0.88
          DESC
      ) AS _final_pos
    FROM combined c
  ),
  _reel_feed_page AS (
    SELECT
      s.id, s.created_at, s.endpoint, s.filename, s.unique_id,
      s.file_size, s.file_type, s.is_adult, s.owner_id, s.is_public,
      s.file_description, s.file_title, s.default_thumbnail, s.view_count,
      s.share_count, s.is_reel, s.duration, s.categories, s.tags,
      s.colors, s.metadata, s.captions,
      s._like_count, s._dislike_count, s._comment_count,
      (
        LEAST(s._eng_velocity / 5.0, 1.0) * 25.0
        + s._like_ratio * 20.0
        + EXP(-s._hours_old / 168.0)::float * 20.0
        + LN(GREATEST(s._total_eng, 1))::float * 15.0
        + LEAST(s._cat_affinity / 5.0, 10.0)
        + (CASE WHEN s._is_subscribed THEN 10.0 ELSE 0.0 END)
      )::float AS engagement_score,
      s._pool,
      u.username, u.profile_pic, u.verified, u.about,
      s._user_liked, s._user_disliked,
      s._final_pos
    FROM shuffled s
    JOIN users u ON u.id = s.owner_id
    ORDER BY s._final_pos ASC
    LIMIT p_limit
  ),
  _reel_feed_marked AS (
    SELECT
      fp.*,
      CASE
        WHEN COALESCE(fp.is_reel, false) IS NOT TRUE THEN fp._final_pos
        WHEN NOT COALESCE(LAG(fp.is_reel) OVER (ORDER BY fp._final_pos), false) THEN fp._final_pos
        ELSE NULL
      END AS _cluster_start
    FROM _reel_feed_page fp
  ),
  _reel_feed_clustered AS (
    SELECT
      fm.*,
      MAX(fm._cluster_start) OVER (
        ORDER BY fm._final_pos ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS feed_reel_cluster_id
    FROM _reel_feed_marked fm
  )
  SELECT
    fc.id, fc.created_at, fc.endpoint, fc.filename, fc.unique_id,
    fc.file_size, fc.file_type, fc.is_adult, fc.owner_id, fc.is_public,
    fc.file_description, fc.file_title, fc.default_thumbnail, fc.view_count,
    fc.share_count, fc.is_reel, fc.duration, fc.categories, fc.tags,
    fc.colors, fc.metadata, fc.captions,
    fc._like_count, fc._dislike_count, fc._comment_count,
    fc.engagement_score,
    fc._pool,
    fc.username, fc.profile_pic, fc.verified, fc.about,
    fc._user_liked, fc._user_disliked,
    fc.feed_reel_cluster_id
  FROM _reel_feed_clustered fc
  ORDER BY fc._final_pos ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_reel_feed(uuid, int, text, text, int, uuid[], numeric) TO anon, authenticated;


-- ============================================================
-- RELATED v5  Smart related with subscription + category affinity
-- ============================================================
DROP FUNCTION IF EXISTS get_related;

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
  default_thumbnail text,
  view_count       numeric,
  share_count      numeric,
  is_reel          boolean,
  duration         numeric,
  categories       jsonb,
  tags             jsonb,
  colors           jsonb,
  metadata         jsonb,
  captions         jsonb,
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
  user_has_disliked boolean,
  feed_reel_cluster_id bigint
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_owner_id   uuid;
  v_tags       jsonb;
  v_categories jsonb;
  v_file_type  text;
BEGIN
  SELECT f.owner_id, f.tags, f.categories, f.file_type
  INTO v_owner_id, v_tags, v_categories, v_file_type
  FROM files f
  WHERE f.id = p_file_id AND f.is_public = true;

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
  sub_channels AS (
    SELECT s.channel_id FROM subscriptions s
    WHERE s.subscriber_id = p_user_id AND p_user_id IS NOT NULL
  ),
  -- What the viewer likes (for category affinity in related)
  user_cat_affinity AS (
    SELECT cat.value AS category, COUNT(*) AS affinity_score
    FROM likes l
    JOIN files f ON f.id = l.file_id
    CROSS JOIN LATERAL jsonb_array_elements_text(f.categories) AS cat(value)
    WHERE l.user_id = p_user_id
      AND p_user_id IS NOT NULL
      AND f.categories IS NOT NULL
      AND jsonb_typeof(f.categories) = 'array'
    GROUP BY cat.value
    ORDER BY COUNT(*) DESC
    LIMIT 10
  ),
  candidates AS (
    SELECT
      f.id, f.created_at, f.endpoint, f.filename, f.unique_id,
      f.file_size, f.file_type, f.is_adult, f.owner_id, f.is_public,
      f.file_description, f.file_title, COALESCE(f.default_thumbnail, (SELECT t #>> '{}' FROM unnest(f.thumbnails) AS t WHERE (t #>> '{}') LIKE '%thumbnail_preview.jpg' LIMIT 1)) AS default_thumbnail, f.view_count,
      f.share_count, f.is_reel, f.duration, f.categories, f.tags,
      f.colors, f.metadata, f.captions,
      COALESCE(es.like_count, 0)    AS _like_count,
      COALESCE(es.dislike_count, 0) AS _dislike_count,
      COALESCE(es.comment_count, 0) AS _comment_count,
      (ul.file_id IS NOT NULL)      AS _user_liked,
      (ud.file_id IS NOT NULL)      AS _user_disliked,
      (sc.channel_id IS NOT NULL)   AS _is_subscribed,
      (COALESCE(es.like_count, 0) + COALESCE(es.comment_count, 0) + f.share_count + f.view_count)::float AS _total_eng,
      -- Like ratio
      CASE WHEN (COALESCE(es.like_count, 0) + COALESCE(es.dislike_count, 0)) > 0 THEN
        COALESCE(es.like_count, 0)::float / (COALESCE(es.like_count, 0) + COALESCE(es.dislike_count, 0))::float
      ELSE 0.5 END AS _like_ratio,
      -- Category affinity from viewer's likes
      COALESCE((
        SELECT SUM(uca.affinity_score)::float
        FROM user_cat_affinity uca
        WHERE f.categories IS NOT NULL
          AND jsonb_typeof(f.categories) = 'array'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(COALESCE(f.categories, '[]'::jsonb)) AS fc(cat)
            WHERE fc.cat = uca.category
          )
      ), 0.0) AS _cat_affinity,
      -- Relevance score: same owner > tags > categories > same type > subscribed
      (
        CASE WHEN f.owner_id = v_owner_id THEN 100.0 ELSE 0.0 END
        + CASE
            WHEN v_tags IS NOT NULL AND f.tags IS NOT NULL
                 AND EXISTS (
                   SELECT 1 FROM jsonb_array_elements_text(COALESCE(v_tags, '[]'::jsonb)) AS vt(tag)
                   JOIN jsonb_array_elements_text(COALESCE(f.tags, '[]'::jsonb)) AS ft(tag) ON vt.tag = ft.tag
                 )
            THEN 50.0
            ELSE 0.0
          END
        + CASE
            WHEN v_categories IS NOT NULL AND f.categories IS NOT NULL
                 AND EXISTS (
                   SELECT 1 FROM jsonb_array_elements_text(COALESCE(v_categories, '[]'::jsonb)) AS vc(cat)
                   JOIN jsonb_array_elements_text(COALESCE(f.categories, '[]'::jsonb)) AS fc(cat) ON vc.cat = fc.cat
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
        + CASE WHEN sc.channel_id IS NOT NULL THEN 15.0 ELSE 0.0 END  -- subscribed channel bonus
      )::float AS _rel_score
    FROM files f
    LEFT JOIN file_engagement_stats es ON es.file_id = f.id
    LEFT JOIN user_likes ul ON ul.file_id = f.id
    LEFT JOIN user_dislikes ud ON ud.file_id = f.id
    LEFT JOIN sub_channels sc ON sc.channel_id = f.owner_id
    WHERE f.id != p_file_id
      AND f.is_public = true
      AND f.is_adult = false
      AND f.upload_status = 'complete'
      AND (f.is_series_main OR COALESCE(f.is_files_series_item, false) IS NOT TRUE)
      AND (p_user_id IS NULL OR ud.file_id IS NULL)
      AND (p_exclude_ids = '{}'::uuid[] OR f.id != ALL(p_exclude_ids))
  ),
  ranked AS (
    SELECT c.*,
      ROW_NUMBER() OVER (
        ORDER BY
          -- Primary: relevance score (content similarity)
          c._rel_score DESC,
          -- Secondary: quality * engagement * category affinity
          (c._like_ratio * 0.3 + LN(GREATEST(c._total_eng, 1)) * 0.4 + LEAST(c._cat_affinity / 10.0, 0.3)) DESC,
          c.created_at DESC,
          c.id
      ) AS _rn
    FROM candidates c
  ),
  _related_page AS (
    SELECT
      r.id, r.created_at, r.endpoint, r.filename, r.unique_id,
      r.file_size, r.file_type, r.is_adult, r.owner_id, r.is_public,
      r.file_description, r.file_title, r.default_thumbnail, r.view_count,
      r.share_count, r.is_reel, r.duration, r.categories, r.tags,
      r.colors, r.metadata,
      r._like_count, r._dislike_count, r._comment_count,
      (r._rel_score
       + r._like_ratio * 10.0
       + LN(GREATEST(r._total_eng, 1))::float * 5.0
       + LEAST(r._cat_affinity, 10.0)
      )::float AS engagement_score,
      'related'::text AS feed_pool,
      u.username, u.profile_pic, u.verified, u.about,
      r._user_liked, r._user_disliked,
      r._rn
    FROM ranked r
    JOIN users u ON u.id = r.owner_id
    WHERE r._rn > p_cursor_pos
    ORDER BY r._rn ASC
    LIMIT p_limit
  ),
  _related_marked AS (
    SELECT
      rp.*,
      CASE
        WHEN COALESCE(rp.is_reel, false) IS NOT TRUE THEN rp._rn
        WHEN NOT COALESCE(LAG(rp.is_reel) OVER (ORDER BY rp._rn), false) THEN rp._rn
        ELSE NULL
      END AS _cluster_start
    FROM _related_page rp
  ),
  _related_clustered AS (
    SELECT
      rm.*,
      MAX(rm._cluster_start) OVER (
        ORDER BY rm._rn ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS feed_reel_cluster_id
    FROM _related_marked rm
  )
  SELECT
    rc.id, rc.created_at, rc.endpoint, rc.filename, rc.unique_id,
    rc.file_size, rc.file_type, rc.is_adult, rc.owner_id, rc.is_public,
    rc.file_description, rc.file_title, rc.default_thumbnail, rc.view_count,
    rc.share_count, rc.is_reel, rc.duration, rc.categories, rc.tags,
    rc.colors, rc.metadata, rc.captions,
    rc._like_count, rc._dislike_count, rc._comment_count,
    rc.engagement_score,
    rc.feed_pool,
    rc.username, rc.profile_pic, rc.verified, rc.about,
    rc._user_liked, rc._user_disliked,
    rc.feed_reel_cluster_id
  FROM _related_clustered rc
  ORDER BY rc._rn ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_related TO anon, authenticated;


-- ============================================================
-- Update get_subscription_feed to use same smart scoring
-- ============================================================
DROP FUNCTION IF EXISTS get_subscription_feed(uuid, int, int);

CREATE OR REPLACE FUNCTION get_subscription_feed(
  p_user_id     uuid,
  p_limit       int DEFAULT 20,
  p_cursor_pos  int DEFAULT 0
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
  captions         jsonb,
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
  user_has_disliked boolean,
  feed_reel_cluster_id bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH
  user_likes AS (
    SELECT l.file_id FROM likes l WHERE l.user_id = p_user_id
  ),
  user_dislikes AS (
    SELECT d.file_id FROM dislike d WHERE d.user_id = p_user_id
  ),
  sub_channels AS (
    SELECT s.channel_id, s.notify FROM subscriptions s WHERE s.subscriber_id = p_user_id
  ),
  ranked AS (
    SELECT
      f.id, f.created_at, f.endpoint, f.filename, f.unique_id,
      f.file_size, f.file_type, f.is_adult, f.owner_id, f.is_public,
      f.file_description, f.file_title, COALESCE(f.default_thumbnail, (SELECT t #>> '{}' FROM unnest(f.thumbnails) AS t WHERE (t #>> '{}') LIKE '%thumbnail_preview.jpg' LIMIT 1)) AS default_thumbnail, f.view_count,
      f.share_count, f.is_reel, f.duration, f.categories, f.tags,
      f.colors, f.metadata, f.captions,
      COALESCE(es.like_count, 0)    AS _like_count,
      COALESCE(es.dislike_count, 0) AS _dislike_count,
      COALESCE(es.comment_count, 0) AS _comment_count,
      (ul.file_id IS NOT NULL)      AS _user_liked,
      (ud.file_id IS NOT NULL)      AS _user_disliked,
      -- Engagement score for subscription feed: recency-weighted
      (
        EXP(-EXTRACT(EPOCH FROM (now() - f.created_at)) / 3600.0 / 168.0)::float * 50.0
        + LN(GREATEST(COALESCE(es.like_count, 0) + COALESCE(es.comment_count, 0) + f.share_count + f.view_count, 1))::float * 20.0
        + CASE WHEN (COALESCE(es.like_count, 0) + COALESCE(es.dislike_count, 0)) > 0 THEN
            COALESCE(es.like_count, 0)::float / (COALESCE(es.like_count, 0) + COALESCE(es.dislike_count, 0))::float * 15.0
          ELSE 7.5 END
        + CASE WHEN sc.notify THEN 10.0 ELSE 0.0 END  -- bell-on channels rank higher
      )::float AS _eng_score,
      ROW_NUMBER() OVER (ORDER BY f.created_at DESC) AS _rn
    FROM files f
    JOIN sub_channels sc ON sc.channel_id = f.owner_id
    LEFT JOIN file_engagement_stats es ON es.file_id = f.id
    LEFT JOIN user_likes ul ON ul.file_id = f.id
    LEFT JOIN user_dislikes ud ON ud.file_id = f.id
    WHERE f.is_public = true
      AND f.is_adult = false
      AND (f.upload_status = 'complete' OR f.upload_status = 'completed')
      AND (f.is_series_main OR COALESCE(f.is_files_series_item, false) IS NOT TRUE)
  ),
  _sub_feed_page AS (
    SELECT
      r.id, r.created_at, r.endpoint, r.filename, r.unique_id,
      r.file_size, r.file_type, r.is_adult, r.owner_id, r.is_public,
      r.file_description, r.file_title, r.default_thumbnail, r.view_count,
      r.share_count, r.is_reel, r.duration, r.categories, r.tags,
      r.colors, r.metadata,
      r._like_count, r._dislike_count, r._comment_count,
      r._eng_score AS engagement_score,
      'subscription'::text AS feed_pool,
      u.username, u.profile_pic, u.verified, u.about,
      r._user_liked, r._user_disliked,
      r._rn
    FROM ranked r
    JOIN users u ON u.id = r.owner_id
    WHERE r._rn > p_cursor_pos
    ORDER BY r._rn ASC
    LIMIT p_limit
  ),
  _sub_feed_marked AS (
    SELECT
      sp.*,
      CASE
        WHEN COALESCE(sp.is_reel, false) IS NOT TRUE THEN sp._rn
        WHEN NOT COALESCE(LAG(sp.is_reel) OVER (ORDER BY sp._rn), false) THEN sp._rn
        ELSE NULL
      END AS _cluster_start
    FROM _sub_feed_page sp
  ),
  _sub_feed_clustered AS (
    SELECT
      sm.*,
      MAX(sm._cluster_start) OVER (
        ORDER BY sm._rn ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS feed_reel_cluster_id
    FROM _sub_feed_marked sm
  )
  SELECT
    sc.id, sc.created_at, sc.endpoint, sc.filename, sc.unique_id,
    sc.file_size, sc.file_type, sc.is_adult, sc.owner_id, sc.is_public,
    sc.file_description, sc.file_title, sc.default_thumbnail, sc.view_count,
    sc.share_count, sc.is_reel, sc.duration, sc.categories, sc.tags,
    sc.colors, sc.metadata, sc.captions,
    sc._like_count, sc._dislike_count, sc._comment_count,
    sc.engagement_score,
    sc.feed_pool,
    sc.username, sc.profile_pic, sc.verified, sc.about,
    sc._user_liked, sc._user_disliked,
    sc.feed_reel_cluster_id
  FROM _sub_feed_clustered sc
  ORDER BY sc._rn ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_subscription_feed(uuid, int, int) TO authenticated;
