-- ============================================================
-- CHANNEL LAYOUT v1  YouTube-Studio-style channel home customization
-- ============================================================
-- Adds users.channel_layout (jsonb) holding the creator's arranged home:
--   { "sections":[{"type":"shorts","visible":true}, ...],
--     "trailerFileId": uuid|null,    -- shown to non-subscribers
--     "featuredFileId": uuid|null }  -- shown to subscribers
-- NULL = the app's default layout. Section types: shorts|videos|popular|playlists.
--
-- Also adds get_channel_home(): one round trip returning the top N (default 6)
-- of each content bucket (shorts / videos / popular) for a profile, in the SAME row
-- shape as get_profile_files (so the existing client normalizer + VideoCard
-- just work) plus a `section` discriminator column.
-- Run in Supabase SQL Editor (idempotent).
-- ============================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS channel_layout jsonb;

DROP FUNCTION IF EXISTS get_channel_home(uuid, uuid, int);

CREATE OR REPLACE FUNCTION get_channel_home(
  p_profile_user_id uuid,
  p_viewer_id       uuid DEFAULT NULL,
  p_limit           int  DEFAULT 6
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
  engagement_score float,
  feed_pool        text,
  owner_username    text,
  owner_profile_pic text,
  owner_verified    boolean,
  owner_about       text,
  user_has_liked    boolean,
  user_has_disliked boolean,
  upload_status     text,
  processing_progress smallint,
  section          text
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_is_owner boolean := (p_viewer_id IS NOT NULL AND p_viewer_id = p_profile_user_id);
  v_lim      int := GREATEST(1, LEAST(p_limit, 30));
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      f.id, f.created_at, f.endpoint, f.filename, f.unique_id, f.file_size,
      f.file_type, f.is_adult, f.owner_id, f.is_public, f.file_description, f.file_title,
      COALESCE(f.default_thumbnail, (SELECT t #>> '{}' FROM unnest(f.thumbnails) AS t WHERE (t #>> '{}') LIKE '%thumbnail_preview.jpg' LIMIT 1)) AS default_thumbnail,
      f.view_count, f.share_count, f.is_reel, f.is_series_main, f.is_files_series_item,
      f.file_series_id, f.file_series_episode_id, f.duration, f.categories, f.tags, f.colors, f.metadata,
      f.upload_status, f.processing_progress,
      (SELECT COUNT(*) FROM likes l WHERE l.file_id = f.id)::bigint        AS _like_count,
      (SELECT COUNT(*) FROM dislike d WHERE d.file_id = f.id)::bigint      AS _dislike_count,
      (SELECT COUNT(*) FROM comments c WHERE c.file_id = f.id AND c.is_deleted = false)::bigint AS _comment_count,
      (p_viewer_id IS NOT NULL AND EXISTS (SELECT 1 FROM likes l WHERE l.file_id = f.id AND l.user_id = p_viewer_id))   AS _viewer_liked,
      (p_viewer_id IS NOT NULL AND EXISTS (SELECT 1 FROM dislike d WHERE d.file_id = f.id AND d.user_id = p_viewer_id)) AS _viewer_disliked
    FROM files f
    WHERE f.owner_id = p_profile_user_id
      AND (f.is_series_main OR COALESCE(f.is_files_series_item, false) IS NOT TRUE)
      -- Adult content NEVER appears in channel sections (even for the owner);
      -- it lives only in the owner-only "Flagged" tab (get_profile_adult_files).
      AND COALESCE(f.is_adult, false) = false
      AND (
        v_is_owner
        OR (
          f.is_public = true
          AND (f.upload_status = 'complete' OR f.upload_status = 'completed')
        )
      )
  ),
  shorts AS (
    SELECT b.*, 'shorts'::text AS section,
      ROW_NUMBER() OVER (ORDER BY b.created_at DESC, b.id DESC) AS _rn
    FROM base b WHERE b.is_reel = true
  ),
  videos AS (
    SELECT b.*, 'videos'::text AS section,
      ROW_NUMBER() OVER (ORDER BY b.created_at DESC, b.id DESC) AS _rn
    FROM base b WHERE COALESCE(b.is_reel, false) = false
  ),
  popular AS (
    SELECT b.*, 'popular'::text AS section,
      ROW_NUMBER() OVER (ORDER BY b.view_count DESC NULLS LAST, b.created_at DESC, b.id DESC) AS _rn
    FROM base b WHERE COALESCE(b.is_reel, false) = false
  ),
  unioned AS (
    SELECT * FROM shorts  WHERE _rn <= v_lim
    UNION ALL
    SELECT * FROM videos  WHERE _rn <= v_lim
    UNION ALL
    SELECT * FROM popular WHERE _rn <= v_lim
  )
  SELECT
    u.id, u.created_at, u.endpoint, u.filename, u.unique_id, u.file_size,
    u.file_type, u.is_adult, u.owner_id, u.is_public, u.file_description, u.file_title,
    u.default_thumbnail, u.view_count, u.share_count, u.is_reel, u.is_series_main,
    u.is_files_series_item, u.file_series_id, u.file_series_episode_id, u.duration,
    u.categories, u.tags, u.colors, u.metadata,
    u._like_count, u._dislike_count, u._comment_count,
    CASE WHEN GREATEST(u.view_count, 1) > 0 THEN
      (u._like_count + u._comment_count + u.share_count)::float / GREATEST(u.view_count, 1)::float
    ELSE 0.0 END,
    'channel'::text,
    usr.username, usr.profile_pic, usr.verified, usr.about,
    u._viewer_liked, u._viewer_disliked,
    u.upload_status, u.processing_progress,
    u.section
  FROM unioned u
  JOIN users usr ON usr.id = u.owner_id
  ORDER BY u.section, u._rn;
END;
$$;

GRANT EXECUTE ON FUNCTION get_channel_home(uuid, uuid, int) TO anon, authenticated;

-- ------------------------------------------------------------
-- get_profile_adult_files  OWNER-ONLY listing of flagged content.
-- Returns rows ONLY when the viewer is the profile owner; everyone else
-- (including anon) gets nothing. Same shape as get_profile_files.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS get_profile_adult_files(uuid, uuid, int, int);

CREATE OR REPLACE FUNCTION get_profile_adult_files(
  p_profile_user_id uuid,
  p_viewer_id       uuid DEFAULT NULL,
  p_limit           int  DEFAULT 20,
  p_cursor_pos      int  DEFAULT 0
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
  engagement_score float,
  feed_pool        text,
  owner_username    text,
  owner_profile_pic text,
  owner_verified    boolean,
  owner_about       text,
  user_has_liked    boolean,
  user_has_disliked boolean,
  upload_status     text,
  processing_progress smallint,
  total_count       bigint
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  -- Hard owner gate: no owner match → empty set.
  IF p_viewer_id IS NULL OR p_viewer_id <> p_profile_user_id THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT
      f.id, f.created_at, f.endpoint, f.filename, f.unique_id, f.file_size,
      f.file_type, f.is_adult, f.owner_id, f.is_public, f.file_description, f.file_title,
      COALESCE(f.default_thumbnail, (SELECT t #>> '{}' FROM unnest(f.thumbnails) AS t WHERE (t #>> '{}') LIKE '%thumbnail_preview.jpg' LIMIT 1)) AS default_thumbnail,
      f.view_count, f.share_count, f.is_reel, f.is_series_main, f.is_files_series_item,
      f.file_series_id, f.file_series_episode_id, f.duration, f.categories, f.tags, f.colors, f.metadata,
      f.upload_status, f.processing_progress,
      (SELECT COUNT(*) FROM likes l WHERE l.file_id = f.id)::bigint        AS _like_count,
      (SELECT COUNT(*) FROM dislike d WHERE d.file_id = f.id)::bigint      AS _dislike_count,
      (SELECT COUNT(*) FROM comments c WHERE c.file_id = f.id AND c.is_deleted = false)::bigint AS _comment_count,
      EXISTS (SELECT 1 FROM likes l WHERE l.file_id = f.id AND l.user_id = p_viewer_id)   AS _viewer_liked,
      EXISTS (SELECT 1 FROM dislike d WHERE d.file_id = f.id AND d.user_id = p_viewer_id) AS _viewer_disliked
    FROM files f
    WHERE f.owner_id = p_profile_user_id
      AND COALESCE(f.is_adult, false) = true
      AND (f.is_series_main OR COALESCE(f.is_files_series_item, false) IS NOT TRUE)
  ),
  counted AS (SELECT COUNT(*)::bigint AS cnt FROM filtered),
  ranked AS (
    SELECT fl.*, ROW_NUMBER() OVER (ORDER BY fl.created_at DESC, fl.id DESC) AS _rn
    FROM filtered fl
  )
  SELECT
    r.id, r.created_at, r.endpoint, r.filename, r.unique_id, r.file_size,
    r.file_type, r.is_adult, r.owner_id, r.is_public, r.file_description, r.file_title,
    r.default_thumbnail, r.view_count, r.share_count, r.is_reel, r.is_series_main,
    r.is_files_series_item, r.file_series_id, r.file_series_episode_id, r.duration,
    r.categories, r.tags, r.colors, r.metadata,
    r._like_count, r._dislike_count, r._comment_count,
    CASE WHEN GREATEST(r.view_count, 1) > 0 THEN
      (r._like_count + r._comment_count + r.share_count)::float / GREATEST(r.view_count, 1)::float
    ELSE 0.0 END,
    'profile'::text,
    u.username, u.profile_pic, u.verified, u.about,
    r._viewer_liked, r._viewer_disliked,
    r.upload_status, r.processing_progress,
    c.cnt
  FROM ranked r
  JOIN users u ON u.id = r.owner_id
  CROSS JOIN counted c
  WHERE r._rn > p_cursor_pos
  ORDER BY r._rn ASC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_profile_adult_files(uuid, uuid, int, int) TO authenticated;

-- ------------------------------------------------------------
-- get_profile_section_files  paginated "See all" for ONE channel section
-- (shorts | videos | popular). Same visibility rules as get_channel_home:
-- adult is NEVER returned (to anyone, incl. the owner); non-owners only see
-- public + complete; the owner also sees their own private/processing items.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS get_profile_section_files(uuid, uuid, text, int, int);

CREATE OR REPLACE FUNCTION get_profile_section_files(
  p_profile_user_id uuid,
  p_viewer_id       uuid DEFAULT NULL,
  p_section         text DEFAULT 'videos',
  p_limit           int  DEFAULT 24,
  p_cursor_pos      int  DEFAULT 0
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
  engagement_score float,
  feed_pool        text,
  owner_username    text,
  owner_profile_pic text,
  owner_verified    boolean,
  owner_about       text,
  user_has_liked    boolean,
  user_has_disliked boolean,
  upload_status     text,
  processing_progress smallint,
  total_count       bigint
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_is_owner boolean := (p_viewer_id IS NOT NULL AND p_viewer_id = p_profile_user_id);
  v_section  text := lower(coalesce(p_section, ''));
BEGIN
  IF v_section NOT IN ('shorts', 'videos', 'popular') THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT
      f.id, f.created_at, f.endpoint, f.filename, f.unique_id, f.file_size,
      f.file_type, f.is_adult, f.owner_id, f.is_public, f.file_description, f.file_title,
      COALESCE(f.default_thumbnail, (SELECT t #>> '{}' FROM unnest(f.thumbnails) AS t WHERE (t #>> '{}') LIKE '%thumbnail_preview.jpg' LIMIT 1)) AS default_thumbnail,
      f.view_count, f.share_count, f.is_reel, f.is_series_main, f.is_files_series_item,
      f.file_series_id, f.file_series_episode_id, f.duration, f.categories, f.tags, f.colors, f.metadata,
      f.upload_status, f.processing_progress,
      (SELECT COUNT(*) FROM likes l WHERE l.file_id = f.id)::bigint        AS _like_count,
      (SELECT COUNT(*) FROM dislike d WHERE d.file_id = f.id)::bigint      AS _dislike_count,
      (SELECT COUNT(*) FROM comments c WHERE c.file_id = f.id AND c.is_deleted = false)::bigint AS _comment_count,
      (p_viewer_id IS NOT NULL AND EXISTS (SELECT 1 FROM likes l WHERE l.file_id = f.id AND l.user_id = p_viewer_id))   AS _viewer_liked,
      (p_viewer_id IS NOT NULL AND EXISTS (SELECT 1 FROM dislike d WHERE d.file_id = f.id AND d.user_id = p_viewer_id)) AS _viewer_disliked
    FROM files f
    WHERE f.owner_id = p_profile_user_id
      AND (f.is_series_main OR COALESCE(f.is_files_series_item, false) IS NOT TRUE)
      AND COALESCE(f.is_adult, false) = false
      AND (
        v_is_owner
        OR (
          f.is_public = true
          AND (f.upload_status = 'complete' OR f.upload_status = 'completed')
        )
      )
      AND (
        (v_section = 'shorts' AND COALESCE(f.is_reel, false) = true)
        OR (v_section IN ('videos', 'popular') AND COALESCE(f.is_reel, false) = false)
      )
  ),
  counted AS (SELECT COUNT(*)::bigint AS cnt FROM filtered),
  ranked AS (
    SELECT fl.*,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE WHEN v_section = 'popular' THEN fl.view_count END DESC NULLS LAST,
          fl.created_at DESC, fl.id DESC
      ) AS _rn
    FROM filtered fl
  )
  SELECT
    r.id, r.created_at, r.endpoint, r.filename, r.unique_id, r.file_size,
    r.file_type, r.is_adult, r.owner_id, r.is_public, r.file_description, r.file_title,
    r.default_thumbnail, r.view_count, r.share_count, r.is_reel, r.is_series_main,
    r.is_files_series_item, r.file_series_id, r.file_series_episode_id, r.duration,
    r.categories, r.tags, r.colors, r.metadata,
    r._like_count, r._dislike_count, r._comment_count,
    CASE WHEN GREATEST(r.view_count, 1) > 0 THEN
      (r._like_count + r._comment_count + r.share_count)::float / GREATEST(r.view_count, 1)::float
    ELSE 0.0 END,
    'profile'::text,
    u.username, u.profile_pic, u.verified, u.about,
    r._viewer_liked, r._viewer_disliked,
    r.upload_status, r.processing_progress,
    c.cnt
  FROM ranked r
  JOIN users u ON u.id = r.owner_id
  CROSS JOIN counted c
  WHERE r._rn > p_cursor_pos
  ORDER BY r._rn ASC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_profile_section_files(uuid, uuid, text, int, int) TO anon, authenticated;
