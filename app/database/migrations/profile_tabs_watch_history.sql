-- Profile tabs: watch history table + RPCs for liked / history file grids (owner-only).
-- Playlists tab uses existing get_user_playlists; API filters public vs owner.

CREATE TABLE IF NOT EXISTS user_watch_history (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES files (id) ON DELETE CASCADE,
  last_viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, file_id)
);

CREATE INDEX IF NOT EXISTS idx_user_watch_history_user_viewed
  ON user_watch_history (user_id, last_viewed_at DESC);

ALTER TABLE user_watch_history ENABLE ROW LEVEL SECURITY;

-- Server calls with p_user_id from verified session only (same trust model as get_profile_files).
DROP FUNCTION IF EXISTS touch_user_watch_history(uuid, uuid);
CREATE OR REPLACE FUNCTION touch_user_watch_history(p_user_id uuid, p_file_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO user_watch_history (user_id, file_id, last_viewed_at)
  VALUES (p_user_id, p_file_id, now())
  ON CONFLICT (user_id, file_id) DO UPDATE
  SET last_viewed_at = EXCLUDED.last_viewed_at;
END;
$$;

GRANT EXECUTE ON FUNCTION touch_user_watch_history(uuid, uuid) TO anon, authenticated;

DROP FUNCTION IF EXISTS get_profile_liked_files(uuid, uuid, int, int);
CREATE OR REPLACE FUNCTION get_profile_liked_files(
  p_profile_user_id uuid,
  p_viewer_id uuid DEFAULT NULL,
  p_limit int DEFAULT 20,
  p_cursor_pos int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  endpoint text,
  filename text,
  unique_id text,
  file_size text,
  file_type text,
  is_adult boolean,
  owner_id uuid,
  is_public boolean,
  file_description text,
  file_title text,
  default_thumbnail text,
  view_count numeric,
  share_count numeric,
  is_reel boolean,
  duration numeric,
  categories jsonb,
  tags jsonb,
  colors jsonb,
  metadata jsonb,
  like_count bigint,
  dislike_count bigint,
  comment_count bigint,
  engagement_score float,
  feed_pool text,
  owner_username text,
  owner_profile_pic text,
  owner_verified boolean,
  owner_about text,
  user_has_liked boolean,
  user_has_disliked boolean,
  upload_status text,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_owner boolean := (p_viewer_id IS NOT NULL AND p_viewer_id = p_profile_user_id);
BEGIN
  IF NOT v_owner THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH
  base AS (
    SELECT
      f.id AS fid,
      l.id AS like_id,
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
      f.default_thumbnail,
      f.view_count,
      f.share_count,
      f.is_reel,
      f.duration,
      f.categories,
      f.tags,
      f.colors,
      f.metadata,
      f.upload_status
    FROM likes l
    JOIN files f ON f.id = l.file_id
    WHERE l.user_id = p_profile_user_id
      AND (f.upload_status = 'complete' OR f.upload_status = 'completed')
  ),
  enriched AS (
    SELECT
      b.*,
      (SELECT COUNT(*)::bigint FROM likes l2 WHERE l2.file_id = b.fid) AS _like_count,
      (SELECT COUNT(*)::bigint FROM dislike d WHERE d.file_id = b.fid) AS _dislike_count,
      (SELECT COUNT(*)::bigint FROM comments c WHERE c.file_id = b.fid AND c.is_deleted = false) AS _comment_count,
      (p_viewer_id IS NOT NULL AND EXISTS (SELECT 1 FROM likes l3 WHERE l3.file_id = b.fid AND l3.user_id = p_viewer_id)) AS _viewer_liked,
      (p_viewer_id IS NOT NULL AND EXISTS (SELECT 1 FROM dislike d2 WHERE d2.file_id = b.fid AND d2.user_id = p_viewer_id)) AS _viewer_disliked
    FROM base b
  ),
  counted AS (
    SELECT COUNT(*)::bigint AS cnt FROM enriched
  ),
  ranked AS (
    SELECT
      e.*,
      ROW_NUMBER() OVER (ORDER BY e.like_id DESC) AS _rn
    FROM enriched e
  )
  SELECT
    r.fid,
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
    CASE WHEN GREATEST(r.view_count, 1) > 0 THEN
      (r._like_count + r._comment_count + r.share_count)::float
      / GREATEST(r.view_count, 1)::float
    ELSE 0.0 END,
    'profile_liked'::text,
    u.username,
    u.profile_pic,
    u.verified,
    u.about,
    r._viewer_liked,
    r._viewer_disliked,
    r.upload_status,
    c.cnt
  FROM ranked r
  JOIN users u ON u.id = r.owner_id
  CROSS JOIN counted c
  WHERE r._rn > p_cursor_pos
  ORDER BY r._rn ASC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_profile_liked_files(uuid, uuid, int, int) TO anon, authenticated;

DROP FUNCTION IF EXISTS get_profile_watch_history(uuid, uuid, int, int);
CREATE OR REPLACE FUNCTION get_profile_watch_history(
  p_profile_user_id uuid,
  p_viewer_id uuid DEFAULT NULL,
  p_limit int DEFAULT 20,
  p_cursor_pos int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  endpoint text,
  filename text,
  unique_id text,
  file_size text,
  file_type text,
  is_adult boolean,
  owner_id uuid,
  is_public boolean,
  file_description text,
  file_title text,
  default_thumbnail text,
  view_count numeric,
  share_count numeric,
  is_reel boolean,
  duration numeric,
  categories jsonb,
  tags jsonb,
  colors jsonb,
  metadata jsonb,
  like_count bigint,
  dislike_count bigint,
  comment_count bigint,
  engagement_score float,
  feed_pool text,
  owner_username text,
  owner_profile_pic text,
  owner_verified boolean,
  owner_about text,
  user_has_liked boolean,
  user_has_disliked boolean,
  upload_status text,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_owner boolean := (p_viewer_id IS NOT NULL AND p_viewer_id = p_profile_user_id);
BEGIN
  IF NOT v_owner THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH
  base AS (
    SELECT
      f.id AS fid,
      h.last_viewed_at AS sort_at,
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
      f.default_thumbnail,
      f.view_count,
      f.share_count,
      f.is_reel,
      f.duration,
      f.categories,
      f.tags,
      f.colors,
      f.metadata,
      f.upload_status
    FROM user_watch_history h
    JOIN files f ON f.id = h.file_id
    WHERE h.user_id = p_profile_user_id
      AND (f.upload_status = 'complete' OR f.upload_status = 'completed')
  ),
  enriched AS (
    SELECT
      b.*,
      (SELECT COUNT(*)::bigint FROM likes l2 WHERE l2.file_id = b.fid) AS _like_count,
      (SELECT COUNT(*)::bigint FROM dislike d WHERE d.file_id = b.fid) AS _dislike_count,
      (SELECT COUNT(*)::bigint FROM comments c WHERE c.file_id = b.fid AND c.is_deleted = false) AS _comment_count,
      (p_viewer_id IS NOT NULL AND EXISTS (SELECT 1 FROM likes l3 WHERE l3.file_id = b.fid AND l3.user_id = p_viewer_id)) AS _viewer_liked,
      (p_viewer_id IS NOT NULL AND EXISTS (SELECT 1 FROM dislike d2 WHERE d2.file_id = b.fid AND d2.user_id = p_viewer_id)) AS _viewer_disliked
    FROM base b
  ),
  counted AS (
    SELECT COUNT(*)::bigint AS cnt FROM enriched
  ),
  ranked AS (
    SELECT
      e.*,
      ROW_NUMBER() OVER (ORDER BY e.sort_at DESC NULLS LAST, e.fid DESC) AS _rn
    FROM enriched e
  )
  SELECT
    r.fid,
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
    CASE WHEN GREATEST(r.view_count, 1) > 0 THEN
      (r._like_count + r._comment_count + r.share_count)::float
      / GREATEST(r.view_count, 1)::float
    ELSE 0.0 END,
    'profile_history'::text,
    u.username,
    u.profile_pic,
    u.verified,
    u.about,
    r._viewer_liked,
    r._viewer_disliked,
    r.upload_status,
    c.cnt
  FROM ranked r
  JOIN users u ON u.id = r.owner_id
  CROSS JOIN counted c
  WHERE r._rn > p_cursor_pos
  ORDER BY r._rn ASC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_profile_watch_history(uuid, uuid, int, int) TO anon, authenticated;
