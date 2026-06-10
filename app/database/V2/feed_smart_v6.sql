-- ============================================================
-- FEED v6.0  Instagram-Grade Personalization Engine
-- ============================================================
-- Upgrades over v5:
--   1. Watch time affinity  #1 signal, weighted from file_watch_time
--   2. Creator affinity  boost content from creators user engages with
--   3. Deep interest profiles  pre-computed user_interest_scores replace simple category affinity
--   4. Save signal  saved_files as a strong quality indicator
--   5. Negative signal filtering  hide_creator, not_interested, hide_category
--   6. Session boost parameter  real-time in-session interest adaptation
--   7. Rebalanced pool weights with new signals
-- ============================================================
-- Run in Supabase SQL Editor. Replaces get_feed from v5.
-- Requires: personalization_tables.sql to be run first.
-- ============================================================

DROP FUNCTION IF EXISTS get_feed;

CREATE OR REPLACE FUNCTION get_feed(
  p_user_id       uuid    DEFAULT NULL,
  p_limit         int     DEFAULT 20,
  p_category      text    DEFAULT NULL,
  p_reels_only    boolean DEFAULT false,
  p_seed          text    DEFAULT 'default',
  p_cursor_pos    int     DEFAULT 0,
  p_exclude_ids   uuid[]  DEFAULT '{}'::uuid[],
  p_session_cats  text[]  DEFAULT '{}'::text[]   -- NEW: categories from in-session likes
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
  user_has_saved    boolean,
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
  v_has_profile boolean := false;
BEGIN
  -- Check if user has subscriptions
  IF p_user_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM subscriptions WHERE subscriber_id = p_user_id LIMIT 1
    ) INTO v_has_subs;

    -- Check if user has computed interest profile
    SELECT EXISTS (
      SELECT 1 FROM user_interest_scores WHERE user_id = p_user_id LIMIT 1
    ) INTO v_has_profile;
  END IF;

  -- Pool allocation with personalization awareness
  IF v_has_subs AND v_has_profile THEN
    -- Full personalization: heavily weighted to personal signals
    v_fresh_lim := GREATEST(CEIL(p_limit * 0.20)::int, 1);
    v_trend_lim := GREATEST(CEIL(p_limit * 0.15)::int, 1);
    v_pop_lim   := GREATEST(CEIL(p_limit * 0.15)::int, 1);
    v_sub_lim   := GREATEST(CEIL(p_limit * 0.20)::int, 1);
    v_disc_lim  := GREATEST(p_limit - v_fresh_lim - v_trend_lim - v_pop_lim - v_sub_lim, 1);
  ELSIF v_has_subs THEN
    v_fresh_lim := GREATEST(CEIL(p_limit * 0.25)::int, 1);
    v_trend_lim := GREATEST(CEIL(p_limit * 0.20)::int, 1);
    v_pop_lim   := GREATEST(CEIL(p_limit * 0.15)::int, 1);
    v_sub_lim   := GREATEST(CEIL(p_limit * 0.15)::int, 1);
    v_disc_lim  := GREATEST(p_limit - v_fresh_lim - v_trend_lim - v_pop_lim - v_sub_lim, 1);
  ELSE
    v_fresh_lim := GREATEST(CEIL(p_limit * 0.30)::int, 1);
    v_trend_lim := GREATEST(CEIL(p_limit * 0.25)::int, 1);
    v_pop_lim   := GREATEST(CEIL(p_limit * 0.20)::int, 1);
    v_sub_lim   := 0;
    v_disc_lim  := GREATEST(p_limit - v_fresh_lim - v_trend_lim - v_pop_lim, 1);
  END IF;

  RETURN QUERY
  WITH
  -- User's interactions
  user_likes AS (
    SELECT l.file_id FROM likes l
    WHERE l.user_id = p_user_id AND p_user_id IS NOT NULL
  ),
  user_dislikes AS (
    SELECT d.file_id FROM dislike d
    WHERE d.user_id = p_user_id AND p_user_id IS NOT NULL
  ),
  user_saves AS (
    SELECT sf.file_id FROM saved_files sf
    WHERE sf.user_id = p_user_id AND p_user_id IS NOT NULL
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

  -- Deep interest profile (replaces simple category affinity from v5)
  user_interests AS (
    SELECT uis.category, uis.score AS interest_score
    FROM user_interest_scores uis
    WHERE uis.user_id = p_user_id AND p_user_id IS NOT NULL
    ORDER BY uis.score DESC
    LIMIT 20
  ),

  -- Creator affinity (NEW: boost from high-affinity creators)
  creator_aff AS (
    SELECT uca.creator_id, uca.affinity_score
    FROM user_creator_affinity uca
    WHERE uca.user_id = p_user_id AND p_user_id IS NOT NULL
    ORDER BY uca.affinity_score DESC
    LIMIT 50
  ),

  -- Negative signals: specific files to hide
  neg_files AS (
    SELECT ns.file_id FROM feed_negative_signals ns
    WHERE ns.user_id = p_user_id AND p_user_id IS NOT NULL
      AND ns.signal_type = 'not_interested'
      AND ns.file_id IS NOT NULL
  ),
  -- Negative signals: creators to hide
  neg_creators AS (
    SELECT ns.creator_id FROM feed_negative_signals ns
    WHERE ns.user_id = p_user_id AND p_user_id IS NOT NULL
      AND ns.signal_type = 'hide_creator'
      AND ns.creator_id IS NOT NULL
  ),
  -- Negative signals: categories to hide
  neg_categories AS (
    SELECT ns.category FROM feed_negative_signals ns
    WHERE ns.user_id = p_user_id AND p_user_id IS NOT NULL
      AND ns.signal_type = 'hide_category'
      AND ns.category IS NOT NULL
  ),

  -- Fallback: simple category affinity if no interest profile exists
  simple_cat_affinity AS (
    SELECT cat.value AS category, COUNT(*) AS affinity_score
    FROM likes l
    JOIN files f ON f.id = l.file_id
    CROSS JOIN LATERAL jsonb_array_elements_text(f.categories) AS cat(value)
    WHERE l.user_id = p_user_id
      AND p_user_id IS NOT NULL
      AND NOT v_has_profile  -- Only compute if no deep profile
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
      (usv.file_id IS NOT NULL)     AS _user_saved,
      (us.file_id IS NOT NULL)      AS _is_seen,
      (sc.channel_id IS NOT NULL)   AS _is_subscribed,

      -- Engagement rate
      CASE WHEN GREATEST(f.view_count, 1) > 0 THEN
        (COALESCE(es.like_count, 0) + COALESCE(es.comment_count, 0) + f.share_count)::float
        / GREATEST(f.view_count, 1)::float
      ELSE 0.0 END AS _eng_rate,

      -- Total engagement
      (COALESCE(es.like_count, 0) + COALESCE(es.comment_count, 0) + f.share_count + f.view_count)::float
        AS _total_eng,

      -- Like ratio
      CASE WHEN (COALESCE(es.like_count, 0) + COALESCE(es.dislike_count, 0)) > 0 THEN
        COALESCE(es.like_count, 0)::float / (COALESCE(es.like_count, 0) + COALESCE(es.dislike_count, 0))::float
      ELSE 0.5 END AS _like_ratio,

      -- Engagement velocity
      CASE WHEN EXTRACT(EPOCH FROM (now() - f.created_at)) > 0 THEN
        (COALESCE(es.like_count, 0) + COALESCE(es.comment_count, 0) + f.share_count)::float
        / GREATEST(EXTRACT(EPOCH FROM (now() - f.created_at)) / 3600.0, 1.0)
      ELSE 0.0 END AS _eng_velocity,

      -- Hours old
      EXTRACT(EPOCH FROM (now() - f.created_at)) / 3600.0 AS _hours_old,

      -- DEEP INTEREST SCORE (replaces simple category affinity)
      -- Uses pre-computed user_interest_scores for personalized users,
      -- falls back to simple like-based affinity for others
      COALESCE(
        -- Try deep interest profile first
        (
          SELECT SUM(ui.interest_score)::float
          FROM user_interests ui
          WHERE f.categories IS NOT NULL
            AND jsonb_typeof(f.categories) = 'array'
            AND EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(COALESCE(f.categories, '[]'::jsonb)) AS fc(cat)
              WHERE fc.cat = ui.category
            )
        ),
        -- Fallback to simple affinity
        (
          SELECT SUM(sca.affinity_score)::float
          FROM simple_cat_affinity sca
          WHERE f.categories IS NOT NULL
            AND jsonb_typeof(f.categories) = 'array'
            AND EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(COALESCE(f.categories, '[]'::jsonb)) AS fc(cat)
              WHERE fc.cat = sca.category
            )
        ),
        0.0
      ) AS _interest_score,

      -- CREATOR AFFINITY SCORE (NEW)
      COALESCE(ca.affinity_score, 0.0)::float AS _creator_affinity,

      -- SESSION BOOST (NEW): boost categories the user liked in this session
      CASE WHEN p_session_cats IS NOT NULL AND array_length(p_session_cats, 1) > 0
           AND f.categories IS NOT NULL AND jsonb_typeof(f.categories) = 'array'
           AND EXISTS (
             SELECT 1
             FROM jsonb_array_elements_text(COALESCE(f.categories, '[]'::jsonb)) AS fc(cat)
             WHERE fc.cat = ANY(p_session_cats)
           )
      THEN 1.0
      ELSE 0.0 END AS _session_boost,

      -- Save count on this file (social proof)
      COALESCE((SELECT COUNT(*) FROM saved_files sv WHERE sv.file_id = f.id), 0)::float AS _save_count,

      -- Deterministic shuffle
      (((hashtext(f.id::text || p_seed) % 1000000)::float + 500000.0) / 1000000.0) AS _shuffle

    FROM files f
    LEFT JOIN file_engagement_stats es ON es.file_id = f.id
    LEFT JOIN user_likes ul ON ul.file_id = f.id
    LEFT JOIN user_dislikes ud ON ud.file_id = f.id
    LEFT JOIN user_saves usv ON usv.file_id = f.id
    LEFT JOIN user_seen us ON us.file_id = f.id
    LEFT JOIN sub_channels sc ON sc.channel_id = f.owner_id
    LEFT JOIN creator_aff ca ON ca.creator_id = f.owner_id
    WHERE f.is_public = true
      AND f.is_adult = false
      AND f.upload_status = 'complete'
      -- Never surface the viewer's OWN uploads in their feed (they live on
      -- profile/studio). Mirrors the reel feed rule.
      AND (p_user_id IS NULL OR f.owner_id IS DISTINCT FROM p_user_id)
      AND (f.is_series_main OR COALESCE(f.is_files_series_item, false) IS NOT TRUE)
      AND (p_category IS NULL OR f.categories @> to_jsonb(p_category)::jsonb)
      AND (p_reels_only = false OR f.is_reel = true)
      AND (p_user_id IS NULL OR ud.file_id IS NULL)   -- exclude disliked
      AND (p_exclude_ids = '{}'::uuid[] OR f.id != ALL(p_exclude_ids))
      -- NEW: Negative signal filtering
      AND f.id NOT IN (SELECT nf.file_id FROM neg_files nf)
      AND f.owner_id NOT IN (SELECT nc.creator_id FROM neg_creators nc)
      -- Hide content from hidden categories
      AND NOT EXISTS (
        SELECT 1 FROM neg_categories ngc
        WHERE f.categories IS NOT NULL
          AND jsonb_typeof(f.categories) = 'array'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(f.categories) AS fc(cat)
            WHERE fc.cat = ngc.category
          )
      )
  ),

  -- ── Pool 1: FRESH  new content (last 48h), personalized ranking
  pool_fresh AS (
    SELECT b.*, 'fresh'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen THEN 1 ELSE 0 END) ASC,
          -- v6: interest + creator affinity + recency + subscription + session + shuffle
          (1.0 - LEAST(b._hours_old / 48.0, 1.0)) * 0.25
          + LEAST(b._interest_score / 20.0, 0.20)
          + LEAST(b._creator_affinity / 20.0, 0.15)
          + (CASE WHEN b._is_subscribed THEN 0.15 ELSE 0.0 END)
          + b._session_boost * 0.10
          + b._shuffle * 0.15
          DESC
      ) AS _rn
    FROM base b
    WHERE b._hours_old <= 48
    LIMIT (v_fresh_lim * v_page_mult) * 2
  ),

  -- ── Pool 2: TRENDING  high engagement velocity, personalized
  pool_trending AS (
    SELECT b.*, 'trending'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen THEN 1 ELSE 0 END) ASC,
          LEAST(b._eng_velocity / 10.0, 1.0) * 0.25
          + b._like_ratio * 0.15
          + LEAST(b._interest_score / 20.0, 0.15)
          + LEAST(b._creator_affinity / 20.0, 0.10)
          + b._eng_rate * 0.10
          + (CASE WHEN b._is_subscribed THEN 0.10 ELSE 0.0 END)
          + b._session_boost * 0.05
          + b._shuffle * 0.10
          DESC
      ) AS _rn
    FROM base b
    WHERE b._total_eng >= 3
      AND b.id NOT IN (SELECT pf.id FROM pool_fresh pf WHERE pf._rn <= v_fresh_lim * v_page_mult)
    LIMIT (v_trend_lim * v_page_mult) * 2
  ),

  -- ── Pool 3: POPULAR  high total engagement, quality content
  pool_popular AS (
    SELECT b.*, 'popular'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen THEN 1 ELSE 0 END) ASC,
          LN(GREATEST(b._total_eng, 1)) * 0.25
          + b._like_ratio * 0.15
          + LEAST(b._interest_score / 20.0, 0.15)
          + LEAST(b._creator_affinity / 20.0, 0.10)
          + LEAST(b._save_count / 10.0, 0.10)
          + (CASE WHEN b._is_subscribed THEN 0.10 ELSE 0.0 END)
          + b._shuffle * 0.15
          DESC
      ) AS _rn
    FROM base b
    WHERE b.id NOT IN (SELECT pf.id FROM pool_fresh pf WHERE pf._rn <= v_fresh_lim * v_page_mult)
      AND b.id NOT IN (SELECT pt.id FROM pool_trending pt WHERE pt._rn <= v_trend_lim * v_page_mult)
    LIMIT (v_pop_lim * v_page_mult) * 2
  ),

  -- ── Pool 4: SUBSCRIBED  content from followed channels, personalized order
  pool_subscribed AS (
    SELECT b.*, 'subscribed'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen THEN 1 ELSE 0 END) ASC,
          -- v6: rank subscribed content by creator affinity + recency instead of pure chronological
          LEAST(b._creator_affinity / 20.0, 0.30)
          + (1.0 - LEAST(b._hours_old / 168.0, 1.0)) * 0.40
          + LEAST(b._interest_score / 20.0, 0.15)
          + b._shuffle * 0.15
          DESC
      ) AS _rn
    FROM base b
    WHERE b._is_subscribed = true
      AND b.id NOT IN (SELECT pf.id FROM pool_fresh pf WHERE pf._rn <= v_fresh_lim * v_page_mult)
      AND b.id NOT IN (SELECT pt.id FROM pool_trending pt WHERE pt._rn <= v_trend_lim * v_page_mult)
      AND b.id NOT IN (SELECT pp.id FROM pool_popular pp WHERE pp._rn <= v_pop_lim * v_page_mult)
    LIMIT (v_sub_lim * v_page_mult) * 2
  ),

  -- ── Pool 5: DISCOVERY  diverse content, serendipity with smart nudges
  pool_discovery AS (
    SELECT b.*, 'discovery'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen THEN 1 ELSE 0 END) ASC,
          -- v6: discovery is MORE personalized than v5 (was 90% random)
          -- Now: interest hints + creator discovery + some randomness
          LEAST(b._interest_score / 30.0, 0.20)
          + LEAST(b._creator_affinity / 30.0, 0.10)
          + b._like_ratio * 0.10
          + b._session_boost * 0.05
          + b._shuffle * 0.55
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
          -- v6 final interleave: heavier personalization signals
          (CASE WHEN c._is_subscribed AND NOT c._is_seen THEN 0.10 ELSE 0.0 END)
          + LEAST(c._interest_score / 25.0, 0.15)
          + LEAST(c._creator_affinity / 25.0, 0.10)
          + c._session_boost * 0.05
          + (((hashtext(c.id::text || p_seed || c._pool) % 1000000)::float + 500000.0) / 1000000.0) * 0.60
          DESC
      ) AS _pre_pos
    FROM combined c
  ),

  -- v6.1: Per-creator cap (mirrors get_related's max-2/creator rule).
  -- Soft cap: a creator's items beyond the cap aren't dropped, they're
  -- spread into later page groups so one prolific uploader can't flood a
  -- single page. Subscribed creators get a slightly higher allowance.
  creator_capped AS (
    SELECT sh.*,
      ROW_NUMBER() OVER (PARTITION BY sh.owner_id ORDER BY sh._pre_pos) AS _creator_rn
    FROM shuffled sh
  ),
  positioned AS (
    SELECT cc.*,
      ROW_NUMBER() OVER (
        ORDER BY
          ((cc._creator_rn - 1) / (CASE WHEN cc._is_subscribed THEN 3 ELSE 2 END)) ASC,
          cc._pre_pos ASC
      ) AS _final_pos
    FROM creator_capped cc
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
      -- v6 engagement score: weighted by all personalization signals
      (
        LEAST(s._interest_score / 5.0, 25.0)          -- interest profile: up to 25
        + LEAST(s._creator_affinity / 3.0, 15.0)      -- creator affinity: up to 15
        + LEAST(s._eng_velocity / 5.0, 1.0) * 15.0    -- velocity: up to 15
        + s._like_ratio * 15.0                         -- like ratio: up to 15
        + EXP(-s._hours_old / 168.0)::float * 10.0    -- recency: up to 10
        + LN(GREATEST(s._total_eng, 1))::float * 10.0 -- total engagement: ~10
        + (CASE WHEN s._is_subscribed THEN 5.0 ELSE 0.0 END)  -- subscription: 5
        + LEAST(s._save_count, 5.0)                    -- save count: up to 5
      )::float AS engagement_score,
      s._pool,
      u.username,
      u.profile_pic,
      u.verified,
      u.about,
      s._user_liked,
      s._user_disliked,
      s._user_saved,
      s._final_pos
    FROM positioned s
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
    fc._user_saved,
    fc.feed_reel_cluster_id
  FROM _feed_clustered fc
  ORDER BY fc._final_pos ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_feed TO anon, authenticated;
