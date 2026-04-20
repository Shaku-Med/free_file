-- ============================================================
-- PIP FEED — Same logic as get_feed (feed_smart_v5), but only rows
-- where files.file_type starts with "video" (case-insensitive).
-- Run in Supabase SQL Editor after feed_smart_v5.sql.
-- ============================================================
DROP FUNCTION IF EXISTS get_pip_feed(uuid, int, text, boolean, text, int, uuid[]);

CREATE OR REPLACE FUNCTION get_pip_feed(
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
      AND LOWER(TRIM(COALESCE(f.file_type, ''))) LIKE 'video%'
  ),

  -- ── Pool 1: FRESH — new content (last 48h)
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

  -- ── Pool 2: TRENDING — high engagement velocity
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

  -- ── Pool 3: POPULAR — high total engagement, good ratio
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

  -- ── Pool 4: SUBSCRIBED — content from followed channels (newest first)
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

  -- ── Pool 5: DISCOVERY — diverse content the user hasn't seen
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
    -- Smart engagement score: velocity + like ratio + recency + category + sub boost
    (
      LEAST(s._eng_velocity / 5.0, 1.0) * 25.0            -- velocity (max 25)
      + s._like_ratio * 20.0                                -- like ratio (max 20)
      + EXP(-s._hours_old / 168.0)::float * 20.0           -- exponential decay over 1 week (max 20)
      + LN(GREATEST(s._total_eng, 1))::float * 15.0        -- total engagement (log scale)
      + LEAST(s._cat_affinity / 5.0, 10.0)                 -- category match (max 10)
      + (CASE WHEN s._is_subscribed THEN 10.0 ELSE 0.0 END) -- subscription bonus
    )::float AS engagement_score,
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

GRANT EXECUTE ON FUNCTION get_pip_feed TO anon, authenticated;
