-- ============================================================
-- Playlist functions — CRUD + queries for server-side playlists
-- ============================================================
-- Requires: playlists, playlist_items, files, users tables
-- Run after playlists.sql
-- ============================================================

-- Drop existing overloads
DO $$
DECLARE
  r RECORD;
  fns text[] := ARRAY[
    'get_user_playlists',
    'get_playlist_with_items',
    'create_playlist',
    'update_playlist',
    'delete_playlist',
    'add_playlist_item',
    'remove_playlist_item',
    'reorder_playlist_items',
    'get_playlists_containing_file'
  ];
  fn text;
BEGIN
  FOREACH fn IN ARRAY fns
  LOOP
    FOR r IN
      SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn
    LOOP
      EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE', r.nspname, r.proname, r.args);
    END LOOP;
  END LOOP;
END $$;


-- ============================================================
-- 1. get_user_playlists — list playlists for a user with item counts
-- ============================================================
CREATE OR REPLACE FUNCTION get_user_playlists(p_user_id uuid)
RETURNS TABLE (
  id            uuid,
  created_at    timestamptz,
  updated_at    timestamptz,
  title         text,
  description   text,
  is_public     boolean,
  thumbnail_url text,
  unique_id     text,
  item_count    bigint,
  first_thumb   text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.created_at,
    p.updated_at,
    p.title,
    p.description,
    p.is_public,
    p.thumbnail_url,
    p.unique_id,
    COALESCE(ic.cnt, 0)::bigint AS item_count,
    ft.thumb AS first_thumb
  FROM playlists p
  LEFT JOIN LATERAL (
    SELECT count(*)::bigint AS cnt
    FROM playlist_items pi
    WHERE pi.playlist_id = p.id
  ) ic ON true
  LEFT JOIN LATERAL (
    SELECT f.thumbnails[1]::text AS thumb
    FROM playlist_items pi2
    JOIN files f ON f.id = pi2.file_id
    WHERE pi2.playlist_id = p.id
    ORDER BY pi2.position ASC
    LIMIT 1
  ) ft ON true
  WHERE p.owner_id = p_user_id
  ORDER BY p.updated_at DESC;
$$;


-- ============================================================
-- 2. get_playlist_with_items — full playlist + ordered file list
-- ============================================================
CREATE OR REPLACE FUNCTION get_playlist_with_items(
  p_playlist_id uuid,
  p_user_id     uuid DEFAULT NULL,
  p_limit       int  DEFAULT 100,
  p_offset      int  DEFAULT 0
)
RETURNS TABLE (
  playlist_id        uuid,
  playlist_title     text,
  playlist_desc      text,
  playlist_public    boolean,
  playlist_owner_id  uuid,
  playlist_unique_id text,
  playlist_created   timestamptz,
  playlist_updated   timestamptz,
  item_id            uuid,
  file_id            uuid,
  "position"         int,
  added_at           timestamptz,
  -- file columns
  f_created_at       timestamptz,
  f_endpoint         text,
  f_filename         text,
  f_unique_id        text,
  f_file_size        text,
  f_file_type        text,
  f_is_adult         boolean,
  f_owner_id         uuid,
  f_is_public        boolean,
  f_file_description text,
  f_file_title       text,
  f_thumbnails       jsonb[],
  f_view_count       numeric,
  f_share_count      numeric,
  f_is_reel          boolean,
  f_duration         numeric,
  f_categories       jsonb,
  f_tags             jsonb,
  f_colors           jsonb,
  f_metadata         jsonb,
  -- owner
  owner_username     text,
  owner_profile_pic  text,
  owner_verified     boolean,
  -- engagement
  like_count         bigint,
  dislike_count      bigint,
  comment_count      bigint,
  user_has_liked     boolean,
  user_has_disliked  boolean,
  -- total items in playlist (for pagination)
  total_items        bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_playlist RECORD;
  v_total    bigint;
BEGIN
  SELECT * INTO v_playlist FROM playlists WHERE playlists.id = p_playlist_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- access check: private playlists only visible to owner
  IF v_playlist.is_public = false AND v_playlist.owner_id IS DISTINCT FROM p_user_id THEN
    RETURN;
  END IF;

  SELECT count(*)::bigint INTO v_total FROM playlist_items pi WHERE pi.playlist_id = p_playlist_id;

  RETURN QUERY
  WITH items AS (
    SELECT pi.id AS item_id, pi.file_id, pi.position, pi.added_at
    FROM playlist_items pi
    WHERE pi.playlist_id = p_playlist_id
    ORDER BY pi.position ASC
    LIMIT p_limit OFFSET p_offset
  ),
  user_likes AS (
    SELECT l.file_id FROM likes l WHERE l.user_id = p_user_id AND p_user_id IS NOT NULL
  ),
  user_dislikes AS (
    SELECT d.file_id FROM dislike d WHERE d.user_id = p_user_id AND p_user_id IS NOT NULL
  )
  SELECT
    v_playlist.id,
    v_playlist.title,
    v_playlist.description,
    v_playlist.is_public,
    v_playlist.owner_id,
    v_playlist.unique_id,
    v_playlist.created_at,
    v_playlist.updated_at,
    i.item_id,
    i.file_id,
    i.position,
    i.added_at,
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
    f.thumbnails,
    f.view_count,
    f.share_count,
    f.is_reel,
    f.duration,
    f.categories,
    f.tags,
    f.colors,
    f.metadata,
    u.username,
    u.profile_pic,
    COALESCE(u.verified, false),
    COALESCE(es.like_count, 0)::bigint,
    COALESCE(es.dislike_count, 0)::bigint,
    COALESCE(es.comment_count, 0)::bigint,
    (ul.file_id IS NOT NULL),
    (ud.file_id IS NOT NULL),
    v_total
  FROM items i
  JOIN files f ON f.id = i.file_id
  LEFT JOIN users u ON u.id = f.owner_id
  LEFT JOIN file_engagement_stats es ON es.file_id = f.id
  LEFT JOIN user_likes ul ON ul.file_id = f.id
  LEFT JOIN user_dislikes ud ON ud.file_id = f.id
  ORDER BY i.position ASC;
END;
$$;


-- ============================================================
-- 3. create_playlist
-- ============================================================
CREATE OR REPLACE FUNCTION create_playlist(
  p_user_id    uuid,
  p_title      text,
  p_desc       text DEFAULT NULL,
  p_is_public  boolean DEFAULT true
)
RETURNS TABLE (
  id         uuid,
  title      text,
  description text,
  is_public  boolean,
  unique_id  text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unique text;
  v_title  text;
  v_desc   text;
  v_count  int;
BEGIN
  v_title := trim(p_title);
  IF v_title = '' THEN
    RAISE EXCEPTION 'Title cannot be empty';
  END IF;
  IF char_length(v_title) > 100 THEN
    RAISE EXCEPTION 'Title exceeds maximum length';
  END IF;

  v_desc := NULLIF(trim(COALESCE(p_desc, '')), '');
  IF v_desc IS NOT NULL AND char_length(v_desc) > 500 THEN
    RAISE EXCEPTION 'Description exceeds maximum length';
  END IF;

  SELECT count(*)::int INTO v_count FROM playlists WHERE owner_id = p_user_id;
  IF v_count >= 50 THEN
    RAISE EXCEPTION 'Maximum playlist limit reached';
  END IF;

  v_unique := 'pl_' || encode(gen_random_uuid()::text::bytea, 'hex');

  RETURN QUERY
  INSERT INTO playlists (owner_id, title, description, is_public, unique_id)
  VALUES (p_user_id, v_title, v_desc, p_is_public, v_unique)
  RETURNING playlists.id, playlists.title, playlists.description, playlists.is_public, playlists.unique_id, playlists.created_at;
END;
$$;


-- ============================================================
-- 4. update_playlist (owner only)
-- ============================================================
CREATE OR REPLACE FUNCTION update_playlist(
  p_user_id   uuid,
  p_playlist_id uuid,
  p_title     text DEFAULT NULL,
  p_desc      text DEFAULT NULL,
  p_is_public boolean DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_desc  text;
BEGIN
  IF p_title IS NOT NULL THEN
    v_title := trim(p_title);
    IF v_title = '' THEN
      RAISE EXCEPTION 'Title cannot be empty';
    END IF;
    IF char_length(v_title) > 100 THEN
      RAISE EXCEPTION 'Title exceeds maximum length';
    END IF;
  END IF;

  IF p_desc IS NOT NULL AND char_length(trim(p_desc)) > 500 THEN
    RAISE EXCEPTION 'Description exceeds maximum length';
  END IF;

  UPDATE playlists
  SET
    title       = COALESCE(NULLIF(trim(COALESCE(p_title, '')), ''), title),
    description = CASE WHEN p_desc IS NOT NULL THEN NULLIF(trim(p_desc), '') ELSE description END,
    is_public   = COALESCE(p_is_public, is_public),
    updated_at  = now()
  WHERE id = p_playlist_id AND owner_id = p_user_id;

  RETURN FOUND;
END;
$$;


-- ============================================================
-- 5. delete_playlist (owner only)
-- ============================================================
CREATE OR REPLACE FUNCTION delete_playlist(p_user_id uuid, p_playlist_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM playlists WHERE id = p_playlist_id AND owner_id = p_user_id;
  RETURN FOUND;
END;
$$;


-- ============================================================
-- 6. add_playlist_item — append file to end of playlist
-- ============================================================
CREATE OR REPLACE FUNCTION add_playlist_item(
  p_user_id     uuid,
  p_playlist_id uuid,
  p_file_id     uuid
)
RETURNS TABLE (item_id uuid, "position" int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_pos   int;
  v_id    uuid;
  v_count int;
BEGIN
  SELECT owner_id INTO v_owner FROM playlists WHERE playlists.id = p_playlist_id;
  IF v_owner IS NULL OR v_owner != p_user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM files WHERE files.id = p_file_id) THEN
    RAISE EXCEPTION 'File not found';
  END IF;

  SELECT count(*)::int INTO v_count FROM playlist_items pi WHERE pi.playlist_id = p_playlist_id;
  IF v_count >= 500 THEN
    RAISE EXCEPTION 'Playlist item limit reached';
  END IF;

  SELECT COALESCE(MAX(pi.position), -1) + 1 INTO v_pos
  FROM playlist_items pi WHERE pi.playlist_id = p_playlist_id;

  INSERT INTO playlist_items (playlist_id, file_id, position)
  VALUES (p_playlist_id, p_file_id, v_pos)
  RETURNING playlist_items.id, playlist_items.position INTO v_id, v_pos;

  UPDATE playlists SET updated_at = now() WHERE playlists.id = p_playlist_id;

  RETURN QUERY SELECT v_id, v_pos;
END;
$$;


-- ============================================================
-- 7. remove_playlist_item
-- ============================================================
CREATE OR REPLACE FUNCTION remove_playlist_item(
  p_user_id     uuid,
  p_playlist_id uuid,
  p_file_id     uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT owner_id INTO v_owner FROM playlists WHERE playlists.id = p_playlist_id;
  IF v_owner IS NULL OR v_owner != p_user_id THEN
    RETURN false;
  END IF;

  DELETE FROM playlist_items WHERE playlist_id = p_playlist_id AND file_id = p_file_id;

  IF FOUND THEN
    UPDATE playlists SET updated_at = now() WHERE playlists.id = p_playlist_id;
  END IF;

  RETURN FOUND;
END;
$$;


-- ============================================================
-- 8. reorder_playlist_items — set positions from ordered file_id array
-- ============================================================
CREATE OR REPLACE FUNCTION reorder_playlist_items(
  p_user_id     uuid,
  p_playlist_id uuid,
  p_file_ids    uuid[]
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  i       int;
BEGIN
  SELECT owner_id INTO v_owner FROM playlists WHERE playlists.id = p_playlist_id;
  IF v_owner IS NULL OR v_owner != p_user_id THEN
    RETURN false;
  END IF;

  FOR i IN 1..array_length(p_file_ids, 1) LOOP
    UPDATE playlist_items
    SET "position" = i - 1
    WHERE playlist_id = p_playlist_id AND file_id = p_file_ids[i];
  END LOOP;

  UPDATE playlists SET updated_at = now() WHERE playlists.id = p_playlist_id;
  RETURN true;
END;
$$;


-- ============================================================
-- 9. get_playlists_containing_file — check which of user's playlists
--    already contain a given file (for the "Add to playlist" modal)
-- ============================================================
CREATE OR REPLACE FUNCTION get_playlists_containing_file(
  p_user_id uuid,
  p_file_id uuid
)
RETURNS TABLE (playlist_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pi.playlist_id
  FROM playlist_items pi
  JOIN playlists p ON p.id = pi.playlist_id
  WHERE p.owner_id = p_user_id AND pi.file_id = p_file_id;
$$;


-- ============================================================
-- Grants
-- ============================================================
GRANT EXECUTE ON FUNCTION get_user_playlists(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_playlist_with_items(uuid, uuid, int, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_playlist(uuid, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION update_playlist(uuid, uuid, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_playlist(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION add_playlist_item(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION remove_playlist_item(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION reorder_playlist_items(uuid, uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION get_playlists_containing_file(uuid, uuid) TO authenticated;
