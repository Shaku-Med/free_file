-- get_related v4 — adds session_seed rotation + soft penalty for creators
-- the viewer already saw this session. Kills the "stiff up-next" feeling
-- without changing the v3 ranking model.

DROP FUNCTION IF EXISTS get_related;

CREATE OR REPLACE FUNCTION get_related(
  p_file_id            uuid,
  p_user_id            uuid    DEFAULT NULL,
  p_limit              int     DEFAULT 20,
  p_cursor_pos         int     DEFAULT 0,
  p_exclude_ids        uuid[]  DEFAULT '{}'::uuid[],
  p_session_cats       text[]  DEFAULT '{}'::text[],
  p_session_seed       text    DEFAULT NULL,
  p_seen_creator_ids   uuid[]  DEFAULT '{}'::uuid[]
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
  feed_reel_cluster_id bigint,
  owner_username    text,
  owner_profile_pic text,
  owner_verified    boolean,
  owner_about       text,
  user_has_liked    boolean,
  user_has_disliked boolean
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_owner_id   uuid;
  v_tags       jsonb;
  v_categories jsonb;
  v_file_type  text;
  v_seed       text;
BEGIN
  SELECT f.owner_id, f.tags, f.categories, f.file_type
  INTO v_owner_id, v_tags, v_categories, v_file_type
  FROM files f
  WHERE f.id = p_file_id AND f.is_public = true;

  IF v_owner_id IS NULL THEN RETURN; END IF;

  -- Default seed: user-id + 6-hour bucket. Same user, same 6h window →
  -- consistent order. Next 6h window → completely re-shuffled.
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

  candidates AS (
    SELECT
      f.id, f.created_at, f.endpoint, f.filename, f.unique_id, f.file_size,
      f.file_type, f.is_adult, f.owner_id, f.is_public, f.file_description, f.file_title,
      COALESCE(f.default_thumbnail, (SELECT t #>> '{}' FROM unnest(f.thumbnails) AS t WHERE (t #>> '{}') LIKE '%thumbnail_preview.jpg' LIMIT 1)) AS default_thumbnail,
      f.view_count, f.share_count, f.is_reel, f.is_series_main, f.is_files_series_item,
      f.file_series_id, f.file_series_episode_id, f.duration, f.categories, f.tags, f.colors, f.metadata, f.captions,
      COALESCE(es.like_count, 0)    AS _like_count,
      COALESCE(es.dislike_count, 0) AS _dislike_count,
      COALESCE(es.comment_count, 0) AS _comment_count,
      (ul.file_id IS NOT NULL)      AS _user_liked,
      (ud.file_id IS NOT NULL)      AS _user_disliked,
      (COALESCE(es.like_count, 0) + COALESCE(es.comment_count, 0) + f.share_count + f.view_count)::float AS _total_eng,

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

      -- NEW v4: soft penalty for creators the user already saw this session.
      -- Not a hard exclude — just down-weights so fresh creators surface first.
      CASE WHEN p_seen_creator_ids IS NOT NULL
            AND array_length(p_seen_creator_ids, 1) > 0
            AND f.owner_id = ANY(p_seen_creator_ids)
           THEN -30.0 ELSE 0.0 END::float AS _seen_penalty,

      (sc.creator_id IS NOT NULL) AS _is_subscribed

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
      AND (f.is_series_main OR COALESCE(f.is_files_series_item, false) IS NOT TRUE)
      AND (p_user_id IS NULL OR ud.file_id IS NULL)
      AND (p_exclude_ids = '{}'::uuid[] OR f.id != ALL(p_exclude_ids))
      AND f.id NOT IN (SELECT nf.file_id FROM neg_files nf)
      AND f.owner_id NOT IN (SELECT nc.creator_id FROM neg_creators nc)
  ),

  scored AS (
    SELECT c.*,
      (
          c._rel_score        * 0.50
        + (LEAST(c._interest_score / 10.0, 15.0)
           + LEAST(c._creator_affinity / 10.0, 10.0)
           + c._session_boost
           + c._sub_boost
           + c._sub_recency
           + c._seen_penalty)  * 0.40
        + LN(GREATEST(c._total_eng, 1)) * 0.10
      )::float AS _score,
      -- Stable shuffle key per (seed, file). Same seed → same order;
      -- new seed (every 6h or on manual refresh) → fresh order.
      hashtext(v_seed || ':' || c.id::text) AS _shuffle
    FROM candidates c
  ),

  capped AS (
    SELECT s.*,
      ROW_NUMBER() OVER (
        PARTITION BY s.owner_id
        ORDER BY s._score DESC, s._shuffle, s.created_at DESC, s.id
      ) AS _per_creator_rn
    FROM scored s
  ),

  ranked AS (
    SELECT c.*,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE WHEN c._per_creator_rn <= CASE WHEN c.owner_id = v_owner_id THEN 4 ELSE 2 END
               THEN 0 ELSE 1 END,
          -- Score buckets of width 5 — within a bucket, shuffle by seed.
          -- This is what kills the "same order every time" feel without
          -- losing the ranking quality.
          FLOOR(c._score / 5.0) DESC,
          c._shuffle,
          c.created_at DESC,
          c.id
      ) AS _rn
    FROM capped c
  )

  SELECT
    r.id, r.created_at, r.endpoint, r.filename, r.unique_id, r.file_size,
    r.file_type, r.is_adult, r.owner_id, r.is_public, r.file_description, r.file_title,
    r.default_thumbnail, r.view_count, r.share_count, r.is_reel, r.is_series_main,
    r.is_files_series_item, r.file_series_id, r.file_series_episode_id, r.duration,
    r.categories, r.tags, r.colors, r.metadata, r.captions,
    r._like_count, r._dislike_count, r._comment_count,
    r._score AS engagement_score,
    CASE WHEN r._is_subscribed THEN 'subscription' ELSE 'related' END::text AS feed_pool,
    NULL::bigint AS feed_reel_cluster_id,
    u.username, u.profile_pic, u.verified, u.about,
    r._user_liked, r._user_disliked
  FROM ranked r
  JOIN users u ON u.id = r.owner_id
  WHERE r._rn > p_cursor_pos
  ORDER BY r._rn ASC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_related TO anon, authenticated;
