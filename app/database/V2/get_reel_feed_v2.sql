-- ============================================================
-- REEL FEED v2  Personalized like get_feed v6 but for reels
-- ============================================================
-- Upgrades over v1:
--   1. Interest profile scoring (user_interest_scores)
--   2. Creator affinity boost (user_creator_affinity)
--   3. Session categories boost (p_session_cats)
--   4. Negative signal filtering (not_interested, hide_creator, hide_category)
--   5. Watched IDs deprioritization (p_watched_ids)
--   6. Save signal as quality indicator
--   7. Subscription awareness
-- Requires: personalization_tables.sql + feed_smart_v6.sql tables.
-- ============================================================

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
  user_has_disliked boolean
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_fresh_lim  int;
  v_trend_lim  int;
  v_pop_lim    int;
  v_foryou_lim int;
  v_disc_lim   int;
  v_page_mult  int := 10;
  v_has_profile boolean := false;
BEGIN
  IF p_user_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM user_interest_scores WHERE user_id = p_user_id LIMIT 1
    ) INTO v_has_profile;
  END IF;

  IF v_has_profile THEN
    -- Personalized user: For-You pool gets biggest share
    v_foryou_lim := GREATEST(CEIL(p_limit * 0.35)::int, 1);
    v_trend_lim  := GREATEST(CEIL(p_limit * 0.25)::int, 1);
    v_fresh_lim  := GREATEST(CEIL(p_limit * 0.20)::int, 1);
    v_pop_lim    := GREATEST(CEIL(p_limit * 0.10)::int, 1);
    v_disc_lim   := GREATEST(p_limit - v_foryou_lim - v_trend_lim - v_fresh_lim - v_pop_lim, 1);
  ELSE
    -- Cold start: more trending + fresh, no for-you
    v_foryou_lim := 0;
    v_trend_lim  := GREATEST(CEIL(p_limit * 0.35)::int, 1);
    v_fresh_lim  := GREATEST(CEIL(p_limit * 0.30)::int, 1);
    v_pop_lim    := GREATEST(CEIL(p_limit * 0.20)::int, 1);
    v_disc_lim   := GREATEST(p_limit - v_trend_lim - v_fresh_lim - v_pop_lim, 1);
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
  user_interests AS (
    SELECT uis.category, uis.score AS interest_score
    FROM user_interest_scores uis
    WHERE uis.user_id = p_user_id AND p_user_id IS NOT NULL
    ORDER BY uis.score DESC
    LIMIT 20
  ),
  creator_aff AS (
    SELECT uca.creator_id, uca.affinity_score
    FROM user_creator_affinity uca
    WHERE uca.user_id = p_user_id AND p_user_id IS NOT NULL
    ORDER BY uca.affinity_score DESC
    LIMIT 50
  ),
  neg_files AS (
    SELECT ns.file_id FROM feed_negative_signals ns
    WHERE ns.user_id = p_user_id AND p_user_id IS NOT NULL
      AND ns.signal_type = 'not_interested' AND ns.file_id IS NOT NULL
  ),
  neg_creators AS (
    SELECT ns.creator_id FROM feed_negative_signals ns
    WHERE ns.user_id = p_user_id AND p_user_id IS NOT NULL
      AND ns.signal_type = 'hide_creator' AND ns.creator_id IS NOT NULL
  ),
  neg_categories AS (
    SELECT ns.category FROM feed_negative_signals ns
    WHERE ns.user_id = p_user_id AND p_user_id IS NOT NULL
      AND ns.signal_type = 'hide_category' AND ns.category IS NOT NULL
  ),
  sub_channels AS (
    SELECT s.channel_id FROM subscriptions s
    WHERE s.subscriber_id = p_user_id AND p_user_id IS NOT NULL
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
      f.captions,
      COALESCE(es.like_count, 0)    AS _like_count,
      COALESCE(es.dislike_count, 0) AS _dislike_count,
      COALESCE(es.comment_count, 0) AS _comment_count,
      (ul.file_id IS NOT NULL)      AS _user_liked,
      (ud.file_id IS NOT NULL)      AS _user_disliked,
      (us.file_id IS NOT NULL)      AS _is_seen,
      (sc.channel_id IS NOT NULL)   AS _is_subscribed,
      (f.id = ANY(p_watched_ids))   AS _recently_watched,

      CASE WHEN GREATEST(f.view_count, 1) > 0 THEN
        (COALESCE(es.like_count, 0) + COALESCE(es.comment_count, 0) + f.share_count)::float
        / GREATEST(f.view_count, 1)::float
      ELSE 0.0 END AS _eng_rate,

      (COALESCE(es.like_count, 0) + COALESCE(es.comment_count, 0) + f.share_count + f.view_count)::float
        AS _total_eng,

      CASE WHEN (COALESCE(es.like_count, 0) + COALESCE(es.dislike_count, 0)) > 0 THEN
        COALESCE(es.like_count, 0)::float / (COALESCE(es.like_count, 0) + COALESCE(es.dislike_count, 0))::float
      ELSE 0.5 END AS _like_ratio,

      EXTRACT(EPOCH FROM (now() - f.created_at)) / 3600.0 AS _hours_old,

      -- Interest profile score
      COALESCE(
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
        0.0
      ) AS _interest_score,

      -- Creator affinity
      COALESCE(ca.affinity_score, 0.0)::float AS _creator_affinity,

      -- Session boost
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
    LEFT JOIN sub_channels sc ON sc.channel_id = f.owner_id
    LEFT JOIN creator_aff ca ON ca.creator_id = f.owner_id
    WHERE f.is_public = true
      AND f.is_adult = false
      AND f.upload_status = 'complete'
      AND NOT EXISTS (
        SELECT 1 FROM public.files_series_episode_items esi
        WHERE esi.file_id = f.unique_id
      )
      AND f.is_reel = true
      -- Don't surface the viewer's OWN reels in their feed  people want to
      -- discover other creators, not watch their own clips every time.
      -- (Their reels still show on their profile / studio, just not here.)
      AND (p_user_id IS NULL OR f.owner_id IS DISTINCT FROM p_user_id)
      AND (p_max_duration IS NULL OR f.duration IS NULL OR f.duration <= p_max_duration)
      AND (p_category IS NULL OR f.categories @> to_jsonb(p_category)::jsonb)
      AND (p_user_id IS NULL OR ud.file_id IS NULL)
      AND (p_exclude_ids = '{}'::uuid[] OR f.id != ALL(p_exclude_ids))
      -- Negative signal filtering
      AND f.id NOT IN (SELECT nf.file_id FROM neg_files nf)
      AND f.owner_id NOT IN (SELECT nc.creator_id FROM neg_creators nc)
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

  -- Pool 1: FOR YOU  personalized picks based on interest + creator affinity
  pool_foryou AS (
    SELECT b.*, 'foryou'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen OR b._recently_watched THEN 1 ELSE 0 END) ASC,
          LEAST(b._interest_score / 15.0, 0.30)
          + LEAST(b._creator_affinity / 15.0, 0.20)
          + (CASE WHEN b._is_subscribed THEN 0.15 ELSE 0.0 END)
          + b._session_boost * 0.15
          + b._like_ratio * 0.10
          + b._shuffle * 0.10
          DESC
      ) AS _rn
    FROM base b
    WHERE b._interest_score > 0 OR b._creator_affinity > 0 OR b._is_subscribed
    LIMIT (v_foryou_lim * v_page_mult) * 2
  ),

  -- Pool 2: TRENDING  high engagement velocity
  pool_trending AS (
    SELECT b.*, 'trending'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen OR b._recently_watched THEN 1 ELSE 0 END) ASC,
          b._eng_rate * 0.30
          + b._like_ratio * 0.20
          + LEAST(b._interest_score / 20.0, 0.15)
          + b._session_boost * 0.10
          + b._shuffle * 0.25
          DESC
      ) AS _rn
    FROM base b
    WHERE b._total_eng >= 2
      AND (v_foryou_lim = 0 OR b.id NOT IN (SELECT pf.id FROM pool_foryou pf WHERE pf._rn <= v_foryou_lim * v_page_mult))
    LIMIT (v_trend_lim * v_page_mult) * 2
  ),

  -- Pool 3: FRESH  new reels (last 48h)
  pool_fresh AS (
    SELECT b.*, 'fresh'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen OR b._recently_watched THEN 1 ELSE 0 END) ASC,
          (1.0 - LEAST(b._hours_old / 48.0, 1.0)) * 0.35
          + LEAST(b._interest_score / 20.0, 0.15)
          + b._session_boost * 0.10
          + b._shuffle * 0.40
          DESC
      ) AS _rn
    FROM base b
    WHERE b._hours_old <= 48
      AND (v_foryou_lim = 0 OR b.id NOT IN (SELECT pf.id FROM pool_foryou pf WHERE pf._rn <= v_foryou_lim * v_page_mult))
      AND b.id NOT IN (SELECT pt.id FROM pool_trending pt WHERE pt._rn <= v_trend_lim * v_page_mult)
    LIMIT (v_fresh_lim * v_page_mult) * 2
  ),

  -- Pool 4: POPULAR  proven content
  pool_popular AS (
    SELECT b.*, 'popular'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen OR b._recently_watched THEN 1 ELSE 0 END) ASC,
          LN(GREATEST(b._total_eng, 1)) * 0.35
          + b._like_ratio * 0.20
          + LEAST(b._interest_score / 20.0, 0.10)
          + b._shuffle * 0.35
          DESC
      ) AS _rn
    FROM base b
    WHERE b.id NOT IN (SELECT pf.id FROM pool_foryou pf WHERE pf._rn <= v_foryou_lim * v_page_mult)
      AND b.id NOT IN (SELECT pt.id FROM pool_trending pt WHERE pt._rn <= v_trend_lim * v_page_mult)
      AND b.id NOT IN (SELECT pfr.id FROM pool_fresh pfr WHERE pfr._rn <= v_fresh_lim * v_page_mult)
    LIMIT (v_pop_lim * v_page_mult) * 2
  ),

  -- Pool 5: DISCOVERY  random exploration
  pool_discovery AS (
    SELECT b.*, 'discovery'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen OR b._recently_watched THEN 1 ELSE 0 END) ASC,
          b._session_boost * 0.10
          + b._like_ratio * 0.10
          + b._shuffle * 0.80
          DESC
      ) AS _rn
    FROM base b
    WHERE b.id NOT IN (SELECT pf.id FROM pool_foryou pf WHERE pf._rn <= v_foryou_lim * v_page_mult)
      AND b.id NOT IN (SELECT pt.id FROM pool_trending pt WHERE pt._rn <= v_trend_lim * v_page_mult)
      AND b.id NOT IN (SELECT pfr.id FROM pool_fresh pfr WHERE pfr._rn <= v_fresh_lim * v_page_mult)
      AND b.id NOT IN (SELECT pp.id FROM pool_popular pp WHERE pp._rn <= v_pop_lim * v_page_mult)
    LIMIT (v_disc_lim * v_page_mult) * 2
  ),

  combined AS (
    SELECT * FROM (SELECT * FROM pool_foryou   WHERE _rn <= v_foryou_lim * v_page_mult) fy
    UNION ALL
    SELECT * FROM (SELECT * FROM pool_trending WHERE _rn <= v_trend_lim * v_page_mult)  t
    UNION ALL
    SELECT * FROM (SELECT * FROM pool_fresh    WHERE _rn <= v_fresh_lim * v_page_mult)  f
    UNION ALL
    SELECT * FROM (SELECT * FROM pool_popular  WHERE _rn <= v_pop_lim * v_page_mult)    p
    UNION ALL
    SELECT * FROM (SELECT * FROM pool_discovery WHERE _rn <= v_disc_lim * v_page_mult)  d
  ),

  shuffled AS (
    SELECT c.*,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN c._is_seen OR c._recently_watched THEN 1 ELSE 0 END) ASC,
          LEAST(c._interest_score / 20.0, 0.15)
          + LEAST(c._creator_affinity / 20.0, 0.10)
          + c._session_boost * 0.10
          + (((hashtext(c.id::text || p_seed || c._pool) % 1000000)::float + 500000.0) / 1000000.0) * 0.65
          DESC
      ) AS _pre_pos
    FROM combined c
  ),

  -- Per-creator hard cap (~5% of the pool, min 1) + spread: one bulk
  -- uploader can't turn the reel feed into their profile. Mirrors get_feed.
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
    WHERE cc._creator_rn <= GREATEST(1, CEIL(p_limit * v_page_mult * 0.05)::int)
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
    s.captions,
    s._like_count,
    s._dislike_count,
    s._comment_count,
    (
      LEAST(s._interest_score / 5.0, 25.0)
      + LEAST(s._creator_affinity / 3.0, 15.0)
      + s._eng_rate * 15.0
      + s._like_ratio * 15.0
      + EXP(-s._hours_old / 168.0)::float * 10.0
      + LN(GREATEST(s._total_eng, 1))::float * 10.0
      + s._session_boost * 5.0
      + s._shuffle * 5.0
    )::float AS engagement_score,
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

GRANT EXECUTE ON FUNCTION get_reel_feed(uuid, int, text, text, int, uuid[], numeric, text[], uuid[]) TO anon, authenticated;
