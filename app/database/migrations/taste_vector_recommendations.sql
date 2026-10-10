-- ============================================================
-- Taste vector recommendations: feed, up next and related
-- ============================================================
-- The feed ranked on tags, categories and creators. Those are labels, so two
-- videos with no label in common looked unrelated however alike they were, and
-- every upload already carries an embedding (EmbedAPI, vector(384)) that the
-- feed never read.
--
-- This adds a per viewer TASTE VECTOR: the embeddings of what they liked,
-- saved and finished, minus what they disliked or bailed on, each weighted by
-- how recently it happened. A video that points the same way is something they
-- are likely to want, whether or not it shares a single tag with their history.
--
--   user_taste_vector(user)   builds the vector (weights match tasteProfile.server.ts)
--   get_feed_v8               get_feed v7 + a "for you" pool + taste in every ranking
--   get_related_v7            get_related v6 + taste, scaled by p_taste_weight
--
-- Both also group shorts into shelves of up to five (feed_reel_cluster_id), which
-- the browser used to do by itself after the fact. Doing it here keeps the
-- ranking, and every page arrives already grouped.
--
-- Rollout:
--   * The live get_feed and get_related are left untouched. The app calls the
--     new versions and falls back to the old ones if these are missing or fail.
--   * A viewer with no usable history has no taste vector, and for them both new
--     functions rank exactly like v7 and v6. Only the shorts move, into shelves.
--   * Until this runs, the page groups shorts itself the way it always has.
--
-- Run in the Supabase SQL editor. Requires the vector extension (already used by
-- files.embedding) and the v7 / v6 personalization tables.
-- ============================================================


-- ------------------------------------------------------------
-- 0. Indexes for "this viewer's newest interactions"
-- ------------------------------------------------------------
-- The taste vector reads each signal newest first for one user. These are
-- small tables today, so building them only blocks writes for a moment.
CREATE INDEX IF NOT EXISTS likes_user_created_idx ON likes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dislike_user_created_idx ON dislike (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS saved_files_user_created_idx ON saved_files (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS file_watch_time_user_created_idx ON file_watch_time (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_watch_progress_user_updated_idx ON user_watch_progress (user_id, updated_at DESC);
-- A series' newest episode, for bringing the series back to the feed when one lands.
CREATE INDEX IF NOT EXISTS files_series_episode_items_series_idx ON files_series_episode_items (file_series_id);


-- ------------------------------------------------------------
-- 1. Taste vector
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_taste_vector(p_user_id uuid)
RETURNS vector(384)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  -- Each source is read newest first and capped, rather than cut off at a date.
  -- A date cutoff left anyone who had been away for a few months with no taste
  -- at all, which is exactly when they come back and most need one.
  WITH explicit AS (
    SELECT * FROM (
      SELECT l.file_id, 3.0::float8 AS w, l.created_at AS at
      FROM likes l WHERE l.user_id = p_user_id
      ORDER BY l.created_at DESC LIMIT 400
    ) a
    UNION ALL
    SELECT * FROM (
      SELECT s.file_id, 3.0::float8, s.created_at
      FROM saved_files s WHERE s.user_id = p_user_id
      ORDER BY s.created_at DESC LIMIT 400
    ) b
    UNION ALL
    SELECT * FROM (
      SELECT d.file_id, -4.0::float8, d.created_at
      FROM dislike d WHERE d.user_id = p_user_id
      ORDER BY d.created_at DESC LIMIT 400
    ) c
    UNION ALL
    SELECT * FROM (
      SELECT n.file_id, -4.0::float8, n.created_at
      FROM feed_negative_signals n
      WHERE n.user_id = p_user_id
        AND n.signal_type = 'not_interested'
        AND n.file_id IS NOT NULL
      ORDER BY n.created_at DESC LIMIT 400
    ) d
  ),
  -- One completion per file: the furthest the viewer ever got. Reopening
  -- something already finished must not read as abandoning it.
  watched AS (
    SELECT x.file_id, MAX(x.ratio) AS ratio, MAX(x.dur) AS dur, MAX(x.at) AS at
    FROM (
      SELECT * FROM (
        SELECT wt.file_id,
               LEAST(GREATEST(wt.watch_percentage, 0), 1)::float8 AS ratio,
               wt.total_duration_s::float8 AS dur,
               wt.created_at AS at
        FROM file_watch_time wt WHERE wt.user_id = p_user_id
        ORDER BY wt.created_at DESC LIMIT 800
      ) w1
      UNION ALL
      SELECT * FROM (
        SELECT wp.file_id,
               CASE WHEN wp.duration_s > 0
                    THEN LEAST(GREATEST(wp.current_time_s / wp.duration_s, 0), 1)
                    ELSE 0 END::float8,
               wp.duration_s::float8,
               wp.updated_at
        FROM user_watch_progress wp WHERE wp.user_id = p_user_id
        ORDER BY wp.updated_at DESC LIMIT 400
      ) w2
    ) x
    GROUP BY x.file_id
  ),
  completion AS (
    SELECT file_id,
           CASE WHEN ratio >= 0.8 THEN 2.5
                WHEN ratio >= 0.3 THEN 1.0
                -- Bailing only means "not for me" on something long enough for
                -- the choice to count. Abandoning a 10s clip says nothing.
                WHEN dur >= 30 THEN -1.2
                ELSE 0.0 END AS w,
           at
    FROM watched
  ),
  events AS (
    SELECT * FROM explicit
    UNION ALL
    SELECT * FROM completion WHERE w <> 0
  ),
  -- Recency is measured from the viewer's own latest activity, not from today:
  -- what they liked last week still outranks what they liked in spring, but
  -- someone back after months away keeps the taste they left with. Halved every
  -- 21 days, then capped so a single binge cannot drag the vector toward one
  -- video. Newest 200 files only.
  per_file AS (
    SELECT e.file_id,
           GREATEST(-4.0, LEAST(4.0,
             SUM(e.w * power(0.5,
               EXTRACT(EPOCH FROM ((SELECT MAX(at) FROM events) - e.at)) / 86400.0 / 21.0))
           )) AS w
    FROM events e
    GROUP BY e.file_id
    ORDER BY MAX(e.at) DESC
    LIMIT 200
  ),
  weighted AS (
    SELECT pf.w, f.embedding
    FROM per_file pf
    JOIN files f ON f.id = pf.file_id
    WHERE f.embedding IS NOT NULL
  ),
  -- Weighted sum, one dimension at a time. Plain array arithmetic rather than
  -- vector operators, so it runs on any pgvector version.
  dims AS (
    SELECT d.i, SUM(d.v * wt.w) AS val
    FROM weighted wt
    CROSS JOIN LATERAL unnest(wt.embedding::real[]) WITH ORDINALITY AS d(v, i)
    GROUP BY d.i
  )
  SELECT CASE
    -- It has to be built from something they liked. A vector made only of
    -- dislikes points away from content, not toward it.
    WHEN (SELECT bool_or(w > 0) FROM weighted) IS NOT TRUE THEN NULL
    WHEN (SELECT sqrt(SUM(val * val)) FROM dims) < 1e-6 THEN NULL
    ELSE (SELECT array_agg(val ORDER BY i)::vector(384) FROM dims)
  END;
$$;


-- ------------------------------------------------------------
-- 2. Feed v8
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_feed_v8;

CREATE OR REPLACE FUNCTION public.get_feed_v8(
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
SET search_path = public
AS $$
DECLARE
  v_fresh_lim  int;
  v_trend_lim  int;
  v_pop_lim    int;
  v_sub_lim    int;
  v_you_lim    int := 0;
  v_disc_lim   int;
  v_page_mult  int := 10;
  v_has_subs   boolean := false;
  v_has_profile boolean := false;
  v_taste      vector(384);
  v_has_taste  boolean := false;
BEGIN
  IF p_user_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM subscriptions WHERE subscriber_id = p_user_id LIMIT 1
    ) INTO v_has_subs;

    SELECT EXISTS (
      SELECT 1 FROM user_interest_scores WHERE user_id = p_user_id LIMIT 1
    ) INTO v_has_profile;

    v_taste := user_taste_vector(p_user_id);
    v_has_taste := v_taste IS NOT NULL;
  END IF;

  IF v_has_taste THEN
    -- The "for you" pool is carved mostly out of fresh, trending and popular.
    -- Discovery keeps its share: it is the escape hatch from the taste bubble.
    v_fresh_lim := GREATEST(CEIL(p_limit * 0.15)::int, 1);
    v_trend_lim := GREATEST(CEIL(p_limit * 0.10)::int, 1);
    v_pop_lim   := GREATEST(CEIL(p_limit * 0.10)::int, 1);
    v_sub_lim   := CASE WHEN v_has_subs THEN GREATEST(CEIL(p_limit * 0.15)::int, 1) ELSE 0 END;
    v_you_lim   := GREATEST(CEIL(p_limit * 0.30)::int, 1);
    v_disc_lim  := GREATEST(p_limit - v_fresh_lim - v_trend_lim - v_pop_lim - v_sub_lim - v_you_lim, 1);
  ELSIF v_has_subs AND v_has_profile THEN
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
    SELECT fi.file_id, fi.seen_at FROM feed_impressions fi
    WHERE fi.user_id = p_user_id AND p_user_id IS NOT NULL
  ),
  sub_channels AS (
    SELECT s.channel_id FROM subscriptions s
    WHERE s.subscriber_id = p_user_id AND p_user_id IS NOT NULL
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
      AND ns.signal_type = 'not_interested'
      AND ns.file_id IS NOT NULL
  ),
  neg_creators AS (
    SELECT ns.creator_id FROM feed_negative_signals ns
    WHERE ns.user_id = p_user_id AND p_user_id IS NOT NULL
      AND ns.signal_type = 'hide_creator'
      AND ns.creator_id IS NOT NULL
  ),
  neg_categories AS (
    SELECT ns.category FROM feed_negative_signals ns
    WHERE ns.user_id = p_user_id AND p_user_id IS NOT NULL
      AND ns.signal_type = 'hide_category'
      AND ns.category IS NOT NULL
  ),
  simple_cat_affinity AS (
    SELECT cat.value AS category, COUNT(*) AS affinity_score
    FROM likes l
    JOIN files f ON f.id = l.file_id
    CROSS JOIN LATERAL jsonb_array_elements_text(f.categories) AS cat(value)
    WHERE l.user_id = p_user_id
      AND p_user_id IS NOT NULL
      AND NOT v_has_profile
      AND f.categories IS NOT NULL
      AND jsonb_typeof(f.categories) = 'array'
    GROUP BY cat.value
    ORDER BY COUNT(*) DESC
    LIMIT 10
  ),

  base_raw AS (
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
      -- Seen, unless a new episode of the series came out since, like YouTube.
      (us.file_id IS NOT NULL AND (sl.latest IS NULL OR us.seen_at >= sl.latest)) AS _is_seen,
      (sc.channel_id IS NOT NULL)   AS _is_subscribed,

      CASE WHEN GREATEST(f.view_count, 1) > 0 THEN
        (COALESCE(es.like_count, 0) + COALESCE(es.comment_count, 0) + f.share_count)::float
        / GREATEST(f.view_count, 1)::float
      ELSE 0.0 END AS _eng_rate,

      (COALESCE(es.like_count, 0) + COALESCE(es.comment_count, 0) + f.share_count + f.view_count)::float
        AS _total_eng,

      LEAST(GREATEST(COALESCE(es.action_depth_score, 0)::float, 0.0) / 4.0, 1.0)
        AS _action_depth,

      CASE WHEN (COALESCE(es.like_count, 0) + COALESCE(es.dislike_count, 0)) > 0 THEN
        COALESCE(es.like_count, 0)::float / (COALESCE(es.like_count, 0) + COALESCE(es.dislike_count, 0))::float
      ELSE 0.5 END AS _like_ratio,

      CASE WHEN EXTRACT(EPOCH FROM (now() - f.created_at)) > 0 THEN
        (COALESCE(es.like_count, 0) + COALESCE(es.comment_count, 0) + f.share_count)::float
        / GREATEST(EXTRACT(EPOCH FROM (now() - f.created_at)) / 3600.0, 1.0)
      ELSE 0.0 END AS _eng_velocity,

      -- A series is as new as its newest episode, so a fresh one brings the
      -- whole series back into the fresh pool even after it aged out.
      EXTRACT(EPOCH FROM (now() - GREATEST(f.created_at, COALESCE(sl.latest, f.created_at)))) / 3600.0 AS _hours_old,

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

      COALESCE(ca.affinity_score, 0.0)::float AS _creator_affinity,

      CASE WHEN p_session_cats IS NOT NULL AND array_length(p_session_cats, 1) > 0
           AND f.categories IS NOT NULL AND jsonb_typeof(f.categories) = 'array'
           AND EXISTS (
             SELECT 1
             FROM jsonb_array_elements_text(COALESCE(f.categories, '[]'::jsonb)) AS fc(cat)
             WHERE fc.cat = ANY(p_session_cats)
           )
      THEN 1.0
      ELSE 0.0 END AS _session_boost,

      COALESCE((SELECT COUNT(*) FROM saved_files sv WHERE sv.file_id = f.id), 0)::float AS _save_count,

      (((hashtext(f.id::text || p_seed) % 1000000)::float + 500000.0) / 1000000.0) AS _shuffle,

      -- Raw cosine similarity to the viewer's taste. NULL without a vector.
      CASE WHEN v_has_taste AND f.embedding IS NOT NULL
           THEN (1.0 - (f.embedding <=> v_taste))::float
      END AS _taste_raw

    FROM files f
    LEFT JOIN file_engagement_stats es ON es.file_id = f.id
    LEFT JOIN user_likes ul ON ul.file_id = f.id
    LEFT JOIN user_dislikes ud ON ud.file_id = f.id
    LEFT JOIN user_saves usv ON usv.file_id = f.id
    LEFT JOIN user_seen us ON us.file_id = f.id
    LEFT JOIN sub_channels sc ON sc.channel_id = f.owner_id
    LEFT JOIN creator_aff ca ON ca.creator_id = f.owner_id
    -- Newest public episode of the series this file heads (series mains only).
    LEFT JOIN LATERAL (
      SELECT MAX(ef.created_at) AS latest
      FROM file_series fs
      JOIN files_series_episode_items ei ON ei.file_series_id = fs.id
      JOIN files ef ON ef.unique_id = ei.file_id
      WHERE f.is_series_main
        AND fs.file_id = f.unique_id
        AND ef.is_public = true
        AND ef.is_adult = false
        AND ef.upload_status = 'complete'
    ) sl ON true
    WHERE f.is_public = true
      AND f.is_adult = false
      AND f.upload_status = 'complete'
      AND (p_user_id IS NULL OR f.owner_id IS DISTINCT FROM p_user_id)
      AND (f.is_series_main OR COALESCE(f.is_files_series_item, false) IS NOT TRUE)
      AND (p_category IS NULL OR f.categories @> to_jsonb(p_category)::jsonb)
      AND (p_reels_only = false OR f.is_reel = true)
      AND (p_user_id IS NULL OR ud.file_id IS NULL)
      AND (p_exclude_ids = '{}'::uuid[] OR f.id != ALL(p_exclude_ids))
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

  -- Raw cosine values bunch up differently for every viewer and model, so the
  -- pools read a percentile instead: 1.0 is the best match in this candidate
  -- set, 0.0 the worst. Without a taste vector every row is 0 and the pools
  -- order exactly as v7 did.
  base AS (
    SELECT br.*,
      CASE WHEN v_has_taste
           THEN percent_rank() OVER (ORDER BY br._taste_raw ASC NULLS FIRST)
           ELSE 0.0
      END::float AS _taste
    FROM base_raw br
  ),

  pool_fresh AS (
    SELECT b.*, 'fresh'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen THEN 1 ELSE 0 END) ASC,
          (1.0 - LEAST(b._hours_old / 48.0, 1.0)) * 0.25
          + LEAST(b._interest_score / 20.0, 0.20)
          + LEAST(b._creator_affinity / 20.0, 0.15)
          + (CASE WHEN b._is_subscribed THEN 0.15 ELSE 0.0 END)
          + b._session_boost * 0.10
          + b._action_depth * 0.10
          + b._shuffle * 0.10
          + b._taste * 0.20
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
          LEAST(b._eng_velocity / 10.0, 1.0) * 0.25
          + b._like_ratio * 0.15
          + LEAST(b._interest_score / 20.0, 0.15)
          + LEAST(b._creator_affinity / 20.0, 0.10)
          + b._eng_rate * 0.10
          + (CASE WHEN b._is_subscribed THEN 0.10 ELSE 0.0 END)
          + b._session_boost * 0.05
          + b._action_depth * 0.10
          + b._shuffle * 0.05
          + b._taste * 0.15
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
          LN(GREATEST(b._total_eng, 1)) * 0.25
          + b._like_ratio * 0.15
          + LEAST(b._interest_score / 20.0, 0.15)
          + LEAST(b._creator_affinity / 20.0, 0.10)
          + LEAST(b._save_count / 10.0, 0.10)
          + (CASE WHEN b._is_subscribed THEN 0.10 ELSE 0.0 END)
          + b._action_depth * 0.12
          + b._shuffle * 0.10
          + b._taste * 0.15
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
          LEAST(b._creator_affinity / 20.0, 0.30)
          + (1.0 - LEAST(b._hours_old / 168.0, 1.0)) * 0.40
          + LEAST(b._interest_score / 20.0, 0.15)
          + b._shuffle * 0.15
          + b._taste * 0.15
          DESC
      ) AS _rn
    FROM base b
    WHERE b._is_subscribed = true
      AND b.id NOT IN (SELECT pf.id FROM pool_fresh pf WHERE pf._rn <= v_fresh_lim * v_page_mult)
      AND b.id NOT IN (SELECT pt.id FROM pool_trending pt WHERE pt._rn <= v_trend_lim * v_page_mult)
      AND b.id NOT IN (SELECT pp.id FROM pool_popular pp WHERE pp._rn <= v_pop_lim * v_page_mult)
    LIMIT (v_sub_lim * v_page_mult) * 2
  ),

  -- The retrieval step the big platforms run first: whatever sits closest to
  -- the viewer's taste, regardless of age, popularity or labels. The shuffle
  -- keeps it from serving the identical top list on every refresh.
  pool_for_you AS (
    SELECT b.*, 'for_you'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen THEN 1 ELSE 0 END) ASC,
          b._taste * 0.70
          + b._like_ratio * 0.05
          + LEAST(b._creator_affinity / 20.0, 0.05)
          + b._action_depth * 0.05
          + b._shuffle * 0.15
          DESC
      ) AS _rn
    FROM base b
    WHERE v_has_taste
      AND b._taste_raw IS NOT NULL
      AND b.id NOT IN (SELECT pf.id FROM pool_fresh pf WHERE pf._rn <= v_fresh_lim * v_page_mult)
      AND b.id NOT IN (SELECT pt.id FROM pool_trending pt WHERE pt._rn <= v_trend_lim * v_page_mult)
      AND b.id NOT IN (SELECT pp.id FROM pool_popular pp WHERE pp._rn <= v_pop_lim * v_page_mult)
      AND (v_sub_lim = 0 OR b.id NOT IN (SELECT ps.id FROM pool_subscribed ps WHERE ps._rn <= v_sub_lim * v_page_mult))
    LIMIT (v_you_lim * v_page_mult) * 2
  ),

  -- Discovery deliberately ignores taste: it is the one pool meant to show
  -- something the viewer would not have picked.
  pool_discovery AS (
    SELECT b.*, 'discovery'::text AS _pool,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN b._is_seen THEN 1 ELSE 0 END) ASC,
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
      AND (v_you_lim = 0 OR b.id NOT IN (SELECT py.id FROM pool_for_you py WHERE py._rn <= v_you_lim * v_page_mult))
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
    SELECT * FROM (SELECT * FROM pool_for_you    WHERE _rn <= v_you_lim * v_page_mult)   y
    UNION ALL
    SELECT * FROM (SELECT * FROM pool_discovery  WHERE _rn <= v_disc_lim * v_page_mult)  d
  ),

  shuffled AS (
    SELECT c.*,
      ROW_NUMBER() OVER (
        ORDER BY
          (CASE WHEN c._is_seen THEN 1 ELSE 0 END) ASC,
          (CASE WHEN c._is_subscribed AND NOT c._is_seen THEN 0.10 ELSE 0.0 END)
          + LEAST(c._interest_score / 25.0, 0.15)
          + LEAST(c._creator_affinity / 25.0, 0.10)
          + c._session_boost * 0.05
          + (((hashtext(c.id::text || p_seed || c._pool) % 1000000)::float + 500000.0) / 1000000.0) * 0.60
          + c._taste * 0.25
          DESC
      ) AS _pre_pos
    FROM combined c
  ),

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
  ),

  -- Shorts are served as shelves of up to five. A shelf takes the spot of its
  -- best ranked short and the next four shorts move up into it. This runs over
  -- the whole ranked list and a page never stops halfway through a shelf, so
  -- every page arrives grouped and loading more never adds to a shelf above.
  shelf_numbered AS (
    SELECT p.*,
      CASE WHEN p.is_reel IS TRUE
           THEN ROW_NUMBER() OVER (PARTITION BY p.is_reel IS TRUE ORDER BY p._final_pos)
      END AS _reel_rn
    FROM positioned p
  ),
  shelf_anchored AS (
    SELECT sn.*,
      CASE WHEN sn._reel_rn IS NULL THEN sn._final_pos
           ELSE MIN(sn._final_pos) OVER (PARTITION BY (sn._reel_rn - 1) / 5)
      END AS _shelf_anchor
    FROM shelf_numbered sn
  ),
  shelved AS (
    SELECT sa.*,
      ROW_NUMBER() OVER (ORDER BY sa._shelf_anchor, sa._final_pos) AS _pos
    FROM shelf_anchored sa
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
      s.preview_endpoint,
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
        LEAST(s._interest_score / 5.0, 25.0)
        + LEAST(s._creator_affinity / 3.0, 15.0)
        + LEAST(s._eng_velocity / 5.0, 1.0) * 15.0
        + s._like_ratio * 15.0
        + EXP(-s._hours_old / 168.0)::float * 10.0
        + LN(GREATEST(s._total_eng, 1))::float * 10.0
        + (CASE WHEN s._is_subscribed THEN 5.0 ELSE 0.0 END)
        + LEAST(s._save_count, 5.0)
      )::float AS engagement_score,
      s._pool,
      u.username,
      u.profile_pic,
      u.verified,
      u.about,
      s._user_liked,
      s._user_disliked,
      s._user_saved,
      s._pos,
      CASE WHEN s._reel_rn IS NOT NULL THEN sh.start END AS feed_reel_cluster_id
    FROM shelved s
    -- A shelf's members sit next to each other, so its first spot is this
    -- row's spot minus its place in the shelf. That spot is also its id.
    CROSS JOIN LATERAL (SELECT s._pos - COALESCE((s._reel_rn - 1) % 5, 0) AS start) sh
    JOIN users u ON u.id = s.owner_id
    WHERE s._pos > p_cursor_pos
      AND sh.start <= p_cursor_pos + p_limit
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
    fc.preview_endpoint,
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
  FROM _feed_page fc
  ORDER BY fc._pos ASC;
END;
$$;


-- ------------------------------------------------------------
-- 3. Related v7 (sidebar, up next, reel feed)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_related_v7;

CREATE OR REPLACE FUNCTION public.get_related_v7(
  p_file_id            uuid,
  p_user_id            uuid    DEFAULT NULL,
  p_limit              int     DEFAULT 20,
  p_cursor_pos         int     DEFAULT 0,
  p_exclude_ids        uuid[]  DEFAULT '{}'::uuid[],
  p_session_cats       text[]  DEFAULT '{}'::text[],
  p_session_seed       text    DEFAULT NULL,
  p_seen_creator_ids   uuid[]  DEFAULT '{}'::uuid[],
  p_kind               text    DEFAULT NULL,
  -- How much the viewer's own taste bends the list away from the video. The
  -- sidebar stays about the video (1.0); up next is about what this viewer will
  -- watch next, so it leans further. Clamped to 0..3.
  p_taste_weight       float   DEFAULT 1.0
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
  captions         jsonb,
  like_count       bigint,
  dislike_count    bigint,
  comment_count    bigint,
  engagement_score float,
  feed_pool        text,
  feed_reel_cluster_id bigint,
  owner_username    text,
  owner_profile_pic text,
  owner_verified    boolean,
  owner_about       text,
  user_has_liked    boolean,
  user_has_disliked boolean
)
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_owner_id   uuid;
  v_tags       jsonb;
  v_categories jsonb;
  v_file_type  text;
  v_embedding  vector(384);
  v_lang       text;
  v_has_lane   boolean;
  v_seed       text;
  v_taste      vector(384);
  v_has_taste  boolean := false;
  v_taste_w    float := LEAST(GREATEST(COALESCE(p_taste_weight, 1.0), 0.0), 3.0);
BEGIN
  SELECT f.owner_id, f.tags, f.categories, f.file_type, f.embedding, f.content_language
  INTO v_owner_id, v_tags, v_categories, v_file_type, v_embedding, v_lang
  FROM files f
  WHERE f.id = p_file_id AND f.is_public = true;

  IF v_owner_id IS NULL THEN RETURN; END IF;

  IF p_user_id IS NOT NULL AND v_taste_w > 0 THEN
    v_taste := user_taste_vector(p_user_id);
    v_has_taste := v_taste IS NOT NULL;
  END IF;

  v_has_lane := v_categories IS NOT NULL
    AND jsonb_typeof(v_categories) = 'array'
    AND jsonb_array_length(v_categories) > 0;

  v_seed := COALESCE(NULLIF(p_session_seed, ''),
    COALESCE(p_user_id::text, 'anon') || ':' ||
    (EXTRACT(EPOCH FROM now())::bigint / 21600)::text);

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
  creator_aff AS (
    SELECT uca.creator_id, uca.affinity_score
    FROM user_creator_affinity uca
    WHERE uca.user_id = p_user_id AND p_user_id IS NOT NULL
    ORDER BY uca.affinity_score DESC
    LIMIT 50
  ),
  subscribed_creators AS (
    SELECT s.channel_id AS creator_id
    FROM subscriptions s
    WHERE s.subscriber_id = p_user_id AND p_user_id IS NOT NULL
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

  candidates_raw AS (
    SELECT
      f.id, f.created_at, f.endpoint, f.filename, f.unique_id, f.file_size,
      f.file_type, f.is_adult, f.owner_id, f.is_public, f.file_description, f.file_title,
      COALESCE(f.default_thumbnail, (SELECT t #>> '{}' FROM unnest(f.thumbnails) AS t WHERE (t #>> '{}') LIKE '%thumbnail_preview.jpg' LIMIT 1)) AS default_thumbnail,
      f.preview_endpoint,
      f.view_count, f.share_count, f.is_reel, f.is_series_main, f.is_files_series_item,
      f.file_series_id, f.file_series_episode_id, f.duration, f.categories, f.tags, f.colors, f.metadata, f.captions,
      COALESCE(es.like_count, 0)    AS _like_count,
      COALESCE(es.dislike_count, 0) AS _dislike_count,
      COALESCE(es.comment_count, 0) AS _comment_count,
      (ul.file_id IS NOT NULL)      AS _user_liked,
      (ud.file_id IS NOT NULL)      AS _user_disliked,
      (COALESCE(es.like_count, 0) + COALESCE(es.comment_count, 0) + f.share_count + f.view_count)::float AS _total_eng,

      CASE
        WHEN NOT v_has_lane THEN 0
        WHEN f.categories IS NOT NULL AND jsonb_typeof(f.categories) = 'array'
             AND EXISTS (
               SELECT 1 FROM jsonb_array_elements_text(v_categories) AS vc(cat)
               JOIN jsonb_array_elements_text(f.categories) AS fc(cat) ON vc.cat = fc.cat
             )
        THEN 0 ELSE 1
      END AS _lane,

      CASE
        WHEN v_embedding IS NOT NULL AND f.embedding IS NOT NULL
        THEN GREATEST(0.0, 1.0 - (f.embedding <=> v_embedding))::float * 40.0
        ELSE 0.0
      END AS _vibe_score,

      (
        CASE WHEN f.owner_id = v_owner_id THEN 100.0 ELSE 0.0 END
        + CASE
            WHEN v_tags IS NOT NULL AND f.tags IS NOT NULL
                 AND EXISTS (
                   SELECT 1 FROM jsonb_array_elements_text(COALESCE(v_tags, '[]'::jsonb)) AS vt(tag)
                   JOIN jsonb_array_elements_text(COALESCE(f.tags, '[]'::jsonb)) AS ft(tag) ON vt.tag = ft.tag
                 )
            THEN 50.0 ELSE 0.0 END
        + CASE
            WHEN v_categories IS NOT NULL AND f.categories IS NOT NULL
                 AND EXISTS (
                   SELECT 1 FROM jsonb_array_elements_text(COALESCE(v_categories, '[]'::jsonb)) AS vc(cat)
                   JOIN jsonb_array_elements_text(COALESCE(f.categories, '[]'::jsonb)) AS fc(cat) ON vc.cat = fc.cat
                 )
            THEN 25.0 ELSE 0.0 END
        + CASE
            WHEN v_file_type IS NOT NULL AND f.file_type IS NOT NULL
                 AND split_part(f.file_type, '/', 1) = split_part(v_file_type, '/', 1)
            THEN 20.0 ELSE 0.0 END
        + CASE
            WHEN v_lang IS NOT NULL AND f.content_language = v_lang
            THEN 15.0 ELSE 0.0 END
      )::float AS _rel_score,

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
        ), 0.0
      ) AS _interest_score,

      COALESCE(ca.affinity_score, 0.0)::float AS _creator_affinity,

      CASE WHEN p_session_cats IS NOT NULL AND array_length(p_session_cats, 1) > 0
           AND f.categories IS NOT NULL AND jsonb_typeof(f.categories) = 'array'
           AND EXISTS (
             SELECT 1 FROM jsonb_array_elements_text(COALESCE(f.categories, '[]'::jsonb)) AS fc(cat)
             WHERE fc.cat = ANY(p_session_cats)
           )
      THEN 15.0 ELSE 0.0 END AS _session_boost,

      CASE WHEN sc.creator_id IS NOT NULL THEN 35.0 ELSE 0.0 END AS _sub_boost,

      CASE
        WHEN sc.creator_id IS NOT NULL
         AND f.created_at > now() - interval '30 days'
        THEN 25.0 * (1.0 - EXTRACT(EPOCH FROM (now() - f.created_at)) / EXTRACT(EPOCH FROM interval '30 days'))
        ELSE 0.0
      END::float AS _sub_recency,

      CASE WHEN p_seen_creator_ids IS NOT NULL
            AND array_length(p_seen_creator_ids, 1) > 0
            AND f.owner_id = ANY(p_seen_creator_ids)
           THEN -30.0 ELSE 0.0 END::float AS _seen_penalty,

      COALESCE(es.action_depth_score, 0)::float AS _action_depth,

      (sc.creator_id IS NOT NULL) AS _is_subscribed,

      CASE WHEN v_has_taste AND f.embedding IS NOT NULL
           THEN (1.0 - (f.embedding <=> v_taste))::float
      END AS _taste_raw

    FROM files f
    LEFT JOIN file_engagement_stats es ON es.file_id = f.id
    LEFT JOIN user_likes ul ON ul.file_id = f.id
    LEFT JOIN user_dislikes ud ON ud.file_id = f.id
    LEFT JOIN creator_aff ca ON ca.creator_id = f.owner_id
    LEFT JOIN subscribed_creators sc ON sc.creator_id = f.owner_id
    WHERE f.id != p_file_id
      AND f.is_public = true
      AND f.is_adult = false
      AND f.upload_status = 'complete'
      AND (p_user_id IS NULL OR f.owner_id IS DISTINCT FROM p_user_id)
      AND (f.is_series_main OR COALESCE(f.is_files_series_item, false) IS NOT TRUE)
      AND (p_user_id IS NULL OR ud.file_id IS NULL)
      AND (p_exclude_ids = '{}'::uuid[] OR f.id != ALL(p_exclude_ids))
      AND f.id NOT IN (SELECT nf.file_id FROM neg_files nf)
      AND f.owner_id NOT IN (SELECT nc.creator_id FROM neg_creators nc)
      AND (
        p_kind IS NULL
        OR (p_kind = 'image' AND f.file_type ILIKE 'image/%')
        OR (p_kind = 'video' AND (f.file_type IS NULL OR f.file_type NOT ILIKE 'image/%'))
      )
  ),

  -- Percentile, as in the feed: comparable across viewers, and exactly 0 for
  -- everyone when there is no taste vector, which leaves v6 ordering intact.
  candidates AS (
    SELECT cr.*,
      CASE WHEN v_has_taste
           THEN percent_rank() OVER (ORDER BY cr._taste_raw ASC NULLS FIRST)
           ELSE 0.0
      END::float AS _taste
    FROM candidates_raw cr
  ),

  scored AS (
    SELECT c.*,
      (
          c._rel_score        * 0.50
        + c._vibe_score       * 0.50
        + (LEAST(c._interest_score / 10.0, 15.0)
           + LEAST(c._creator_affinity / 10.0, 10.0)
           + c._session_boost
           + c._sub_boost
           + c._sub_recency
           + c._seen_penalty)  * 0.40
        + LN(GREATEST(c._total_eng, 1)) * 0.10
        + LEAST(GREATEST(c._action_depth, 0.0) / 4.0, 1.0) * 0.15
        -- Up to 12 points at weight 1: a strong nudge, but the video itself
        -- (same creator 50, shared tags 25, same vibe 20) still leads, and the
        -- lane is still sorted on first.
        + c._taste * 12.0 * v_taste_w
      )::float AS _score,
      hashtext(v_seed || ':' || c.id::text) AS _shuffle
    FROM candidates c
  ),

  capped AS (
    SELECT s.*,
      ROW_NUMBER() OVER (
        PARTITION BY s.owner_id
        ORDER BY s._lane ASC, s._score DESC, s._shuffle, s.created_at DESC, s.id
      ) AS _per_creator_rn
    FROM scored s
  ),

  ranked AS (
    SELECT c.*,
      ROW_NUMBER() OVER (
        ORDER BY
          c._lane ASC,
          CASE WHEN c._per_creator_rn <= CASE WHEN c.owner_id = v_owner_id THEN 4 ELSE 2 END
               THEN 0 ELSE 1 END,
          FLOOR(c._score / 5.0) DESC,
          c._shuffle,
          c.created_at DESC,
          c.id
      ) AS _rn
    FROM capped c
  ),

  -- Shorts become shelves of up to five, as in the feed. Shelves stay inside
  -- their lane so videos sharing a category with this one still come first.
  shelf_numbered AS (
    SELECT r.*,
      CASE WHEN r.is_reel IS TRUE
           THEN ROW_NUMBER() OVER (PARTITION BY r._lane, r.is_reel IS TRUE ORDER BY r._rn)
      END AS _reel_rn
    FROM ranked r
  ),
  shelf_anchored AS (
    SELECT sn.*,
      CASE WHEN sn._reel_rn IS NULL THEN sn._rn
           ELSE MIN(sn._rn) OVER (PARTITION BY sn._lane, (sn._reel_rn - 1) / 5)
      END AS _shelf_anchor
    FROM shelf_numbered sn
  ),
  shelved AS (
    SELECT sa.*,
      ROW_NUMBER() OVER (ORDER BY sa._shelf_anchor, sa._rn) AS _pos
    FROM shelf_anchored sa
  )

  SELECT
    r.id, r.created_at, r.endpoint, r.filename, r.unique_id, r.file_size,
    r.file_type, r.is_adult, r.owner_id, r.is_public, r.file_description, r.file_title,
    r.default_thumbnail, r.preview_endpoint, r.view_count, r.share_count, r.is_reel, r.is_series_main,
    r.is_files_series_item, r.file_series_id, r.file_series_episode_id, r.duration,
    r.categories, r.tags, r.colors, r.metadata, r.captions,
    r._like_count, r._dislike_count, r._comment_count,
    r._score AS engagement_score,
    CASE WHEN r._is_subscribed THEN 'subscription' ELSE 'related' END::text AS feed_pool,
    CASE WHEN r._reel_rn IS NOT NULL THEN sh.start END AS feed_reel_cluster_id,
    u.username, u.profile_pic, u.verified, u.about,
    r._user_liked, r._user_disliked
  FROM shelved r
  CROSS JOIN LATERAL (SELECT r._pos - COALESCE((r._reel_rn - 1) % 5, 0) AS start) sh
  JOIN users u ON u.id = r.owner_id
  WHERE r._pos > p_cursor_pos
    AND sh.start <= p_cursor_pos + p_limit
  ORDER BY r._pos ASC;
END;
$$;


-- ------------------------------------------------------------
-- 4. Who may call these
-- ------------------------------------------------------------
-- The server is the only caller, and it connects as service_role. A taste
-- vector is a fingerprint of someone's likes and watch history, so none of
-- these take a user id from anyone else.
REVOKE ALL ON FUNCTION public.user_taste_vector(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_feed_v8(uuid, int, text, boolean, text, int, uuid[], text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_related_v7(uuid, uuid, int, int, uuid[], text[], text, uuid[], text, float) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.user_taste_vector(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_feed_v8(uuid, int, text, boolean, text, int, uuid[], text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_related_v7(uuid, uuid, int, int, uuid[], text[], text, uuid[], text, float) TO service_role;
