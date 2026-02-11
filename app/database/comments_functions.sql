-- ============================================================
-- Comments: SQL functions for nested comments (infinite depth)
-- ============================================================
-- get_comments: returns comment tree for a file (top-level + nested replies)
-- create_comment: add a comment or reply (parent_id = null for top-level)
-- update_comment: edit own comment
-- delete_comment: soft-delete own comment
-- Requires: public.comments table (id, user_id, file_id, content, parent_id, created_at, updated_at, is_edited, is_deleted)
-- ============================================================

DROP FUNCTION IF EXISTS get_comment_count(uuid);
DROP FUNCTION IF EXISTS create_comment(uuid,uuid,text,uuid);
DROP FUNCTION IF EXISTS create_comment(uuid,uuid,text);
DROP FUNCTION IF EXISTS update_comment(uuid,uuid,text);
DROP FUNCTION IF EXISTS delete_comment(uuid,uuid);

-- Drop every overload of get_comments, get_comments_root, get_replies (fixes "function name is not unique")
DO $$
DECLARE
  r RECORD;
  fns text[] := ARRAY['get_comments', 'get_comments_root', 'get_replies'];
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

-- Get comment count for a file (non-deleted)
CREATE OR REPLACE FUNCTION get_comment_count(p_file_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
  SELECT count(*)::bigint
  FROM public.comments
  WHERE file_id = p_file_id AND is_deleted = false;
$$;

-- Create comment or reply (infinite nesting via parent_id)
CREATE OR REPLACE FUNCTION create_comment(
  p_user_id  uuid,
  p_file_id  uuid,
  p_content  text,
  p_parent_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF trim(p_content) = '' OR char_length(trim(p_content)) < 1 THEN
    RAISE EXCEPTION 'Comment content cannot be empty';
  END IF;
  IF char_length(p_content) > 2000 THEN
    RAISE EXCEPTION 'Comment content exceeds maximum length';
  END IF;
  IF p_parent_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.comments WHERE id = p_parent_id AND file_id = p_file_id AND is_deleted = false) THEN
      RAISE EXCEPTION 'Parent comment not found';
    END IF;
  END IF;

  INSERT INTO public.comments (user_id, file_id, content, parent_id)
  VALUES (p_user_id, p_file_id, trim(p_content), p_parent_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Update comment (owner only)
CREATE OR REPLACE FUNCTION update_comment(
  p_user_id    uuid,
  p_comment_id uuid,
  p_content    text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF trim(p_content) = '' OR char_length(trim(p_content)) < 1 THEN
    RAISE EXCEPTION 'Comment content cannot be empty';
  END IF;
  IF char_length(p_content) > 2000 THEN
    RAISE EXCEPTION 'Comment content exceeds maximum length';
  END IF;

  UPDATE public.comments
  SET content = trim(p_content), is_edited = true, updated_at = now()
  WHERE id = p_comment_id AND user_id = p_user_id AND is_deleted = false;

  RETURN FOUND;
END;
$$;

-- Soft-delete comment (owner only)
CREATE OR REPLACE FUNCTION delete_comment(
  p_user_id    uuid,
  p_comment_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.comments
  SET is_deleted = true, updated_at = now()
  WHERE id = p_comment_id AND user_id = p_user_id AND is_deleted = false;

  RETURN FOUND;
END;
$$;

-- Get comments tree for a file (infinite nested replies).
-- Returns one row per comment with: id, user_id, file_id, content, parent_id, created_at, updated_at, is_edited, is_deleted,
-- depth (0 = top-level), path (array of ids from root to this comment), username, profile_pic.
-- Order: top-level by created_at desc, then replies under each by created_at asc. Client can build tree from path/depth.
CREATE OR REPLACE FUNCTION get_comments(
  p_file_id uuid,
  p_limit   int DEFAULT 50,
  p_offset  int DEFAULT 0
)
RETURNS TABLE (
  id         uuid,
  user_id    uuid,
  file_id    uuid,
  content    text,
  parent_id  uuid,
  created_at timestamptz,
  updated_at timestamptz,
  is_edited  boolean,
  depth      int,
  path_ids   uuid[],
  username   text,
  profile_pic text
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE
  tree AS (
    SELECT
      c.id,
      c.user_id,
      c.file_id,
      c.content,
      c.parent_id,
      c.created_at,
      c.updated_at,
      c.is_edited,
      0 AS depth,
      ARRAY[c.id] AS path_ids,
      c.created_at AS root_created_at
    FROM public.comments c
    WHERE c.file_id = p_file_id AND c.is_deleted = false AND c.parent_id IS NULL

    UNION ALL

    SELECT
      c.id,
      c.user_id,
      c.file_id,
      c.content,
      c.parent_id,
      c.created_at,
      c.updated_at,
      c.is_edited,
      t.depth + 1,
      t.path_ids || c.id,
      t.root_created_at
    FROM public.comments c
    JOIN tree t ON c.parent_id = t.id
    WHERE c.is_deleted = false
  ),
  ordered AS (
    SELECT
      t.id, t.user_id, t.file_id, t.content, t.parent_id, t.created_at, t.updated_at, t.is_edited, t.depth, t.path_ids,
      ROW_NUMBER() OVER (ORDER BY t.root_created_at DESC, t.path_ids) AS rn
    FROM tree t
  )
  SELECT
    o.id,
    o.user_id,
    o.file_id,
    o.content,
    o.parent_id,
    o.created_at,
    o.updated_at,
    o.is_edited,
    o.depth,
    o.path_ids,
    u.username,
    u.profile_pic
  FROM ordered o
  JOIN public.users u ON u.id = o.user_id
  WHERE o.rn > p_offset AND o.rn <= p_offset + p_limit
  ORDER BY o.rn;
END;
$$;

-- Simpler: get top-level comments with reply_count (no nested body in one call).
-- For full tree the client can call get_comments and build tree from path_ids/depth, or call get_replies(p_parent_id) recursively.
CREATE OR REPLACE FUNCTION get_comments_root(
  p_file_id uuid,
  p_limit   int DEFAULT 50,
  p_offset  int DEFAULT 0
)
RETURNS TABLE (
  id          uuid,
  user_id     uuid,
  file_id     uuid,
  content     text,
  parent_id   uuid,
  created_at  timestamptz,
  updated_at  timestamptz,
  is_edited   boolean,
  username    text,
  profile_pic text,
  reply_count bigint
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    c.id,
    c.user_id,
    c.file_id,
    c.content,
    c.parent_id,
    c.created_at,
    c.updated_at,
    c.is_edited,
    u.username,
    u.profile_pic,
    (SELECT count(*)::bigint FROM public.comments r WHERE r.parent_id = c.id AND r.is_deleted = false) AS reply_count
  FROM public.comments c
  JOIN public.users u ON u.id = c.user_id
  WHERE c.file_id = p_file_id AND c.is_deleted = false AND c.parent_id IS NULL
  ORDER BY c.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
$$;

-- Get replies for a given parent (any depth) for building tree in app
CREATE OR REPLACE FUNCTION get_replies(
  p_parent_id uuid,
  p_limit     int DEFAULT 100,
  p_offset    int DEFAULT 0
)
RETURNS TABLE (
  id         uuid,
  user_id    uuid,
  file_id    uuid,
  content    text,
  parent_id  uuid,
  created_at timestamptz,
  updated_at timestamptz,
  is_edited  boolean,
  username   text,
  profile_pic text
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    c.id,
    c.user_id,
    c.file_id,
    c.content,
    c.parent_id,
    c.created_at,
    c.updated_at,
    c.is_edited,
    u.username,
    u.profile_pic
  FROM public.comments c
  JOIN public.users u ON u.id = c.user_id
  WHERE c.parent_id = p_parent_id AND c.is_deleted = false
  ORDER BY c.created_at ASC
  LIMIT p_limit
  OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION get_comment_count TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_comment TO authenticated;
GRANT EXECUTE ON FUNCTION update_comment TO authenticated;
GRANT EXECUTE ON FUNCTION delete_comment TO authenticated;
GRANT EXECUTE ON FUNCTION get_comments TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_comments_root TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_replies TO anon, authenticated;
