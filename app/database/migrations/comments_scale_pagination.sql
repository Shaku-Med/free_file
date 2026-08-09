-- ============================================================================
-- Comments at scale: SQL-side pagination + counting
-- ============================================================================
-- (redeploy trigger: no schema change — keep this comment so CI sees an app/ diff)
-- Before this, the app loaded up to 500 comment rows (and EVERY like row for
-- them) into Node memory to sort and paginate. Fine for a quiet upload,
-- useless at 1k comments and fatal at 100k. These functions move the work to
-- Postgres where it is index-backed and page-scoped:
--
--   get_comment_roots_page    one page of top-level comment ids, newest
--                             first, with whole-subtree reply counts and the
--                             total number of roots (for "Load more").
--   get_reply_subtree_counts  subtree sizes for a batch of comment ids
--                             (backs the "View N replies" labels).
--   get_comment_like_counts   like COUNT + did-viewer-like per comment,
--                             instead of shipping every like row to the app.
--   get_visible_comment_count total visible comments for a file: everything
--                             non-deleted minus hidden subtrees.
--
-- Hidden comments (owner moderation) hide their whole subtree from everyone
-- but the file owner; every function takes p_include_hidden so counts always
-- match what that viewer can actually expand.
--
-- Prerequisites: comments.is_hidden (comments_file_settings_owner_moderation.sql).
-- The app degrades gracefully if this migration is not deployed yet — it
-- falls back to the old in-memory path, capped at 500 comments.
-- ============================================================================

-- Index-backed "roots of a file, newest first" — the pagination hot path.
create index if not exists idx_comments_file_roots_created
  on public.comments (file_id, created_at desc)
  where parent_id is null and is_deleted = false;

-- Reply walks descend via parent_id on live rows only.
create index if not exists idx_comments_parent_alive
  on public.comments (parent_id)
  where is_deleted = false;

DROP FUNCTION IF EXISTS get_comment_roots_page(uuid, boolean, int, int);
DROP FUNCTION IF EXISTS get_reply_subtree_counts(uuid, uuid[], boolean);
DROP FUNCTION IF EXISTS get_comment_like_counts(uuid[], uuid);
DROP FUNCTION IF EXISTS get_visible_comment_count(uuid, boolean);

-- One page of top-level comments, newest first. reply_count is the WHOLE
-- subtree under each root (hidden branches excluded unless p_include_hidden),
-- total_roots is the full filtered root count for the file. The recursive
-- walk is seeded ONLY by the page's roots, so its cost tracks the page, not
-- the file. UNION (not UNION ALL) dedupes on (root_id, id), which also makes
-- a corrupted parent cycle terminate instead of looping.
CREATE OR REPLACE FUNCTION get_comment_roots_page(
  p_file_id        uuid,
  p_include_hidden boolean DEFAULT false,
  p_limit          int     DEFAULT 50,
  p_offset         int     DEFAULT 0
)
RETURNS TABLE (comment_id uuid, reply_count bigint, total_roots bigint)
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE page AS (
    SELECT c.id, c.created_at
    FROM public.comments c
    WHERE c.file_id = p_file_id
      AND c.parent_id IS NULL
      AND c.is_deleted = false
      AND (p_include_hidden OR c.is_hidden IS NOT TRUE)
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
    OFFSET LEAST(GREATEST(COALESCE(p_offset, 0), 0), 100000)
  ),
  total AS (
    SELECT count(*)::bigint AS n
    FROM public.comments c
    WHERE c.file_id = p_file_id
      AND c.parent_id IS NULL
      AND c.is_deleted = false
      AND (p_include_hidden OR c.is_hidden IS NOT TRUE)
  ),
  sub AS (
    SELECT p.id AS root_id, c.id
    FROM page p
    JOIN public.comments c ON c.parent_id = p.id
    WHERE c.file_id = p_file_id
      AND c.is_deleted = false
      AND (p_include_hidden OR c.is_hidden IS NOT TRUE)
    UNION
    SELECT s.root_id, c.id
    FROM sub s
    JOIN public.comments c ON c.parent_id = s.id
    WHERE c.file_id = p_file_id
      AND c.is_deleted = false
      AND (p_include_hidden OR c.is_hidden IS NOT TRUE)
  )
  SELECT
    p.id,
    COALESCE(r.cnt, 0),
    (SELECT n FROM total)
  FROM page p
  LEFT JOIN (
    SELECT root_id, count(*)::bigint AS cnt FROM sub GROUP BY root_id
  ) r ON r.root_id = p.id
  ORDER BY p.created_at DESC, p.id DESC;
$$;

-- Subtree size for each id in p_parent_ids (their descendants, all depths).
-- Scoped to p_file_id so a guessed comment id from another file counts nothing.
CREATE OR REPLACE FUNCTION get_reply_subtree_counts(
  p_file_id        uuid,
  p_parent_ids     uuid[],
  p_include_hidden boolean DEFAULT false
)
RETURNS TABLE (parent_id uuid, reply_count bigint)
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE sub AS (
    SELECT r.root_id, c.id
    FROM unnest(p_parent_ids) AS r(root_id)
    JOIN public.comments c ON c.parent_id = r.root_id
    WHERE c.file_id = p_file_id
      AND c.is_deleted = false
      AND (p_include_hidden OR c.is_hidden IS NOT TRUE)
    UNION
    SELECT s.root_id, c.id
    FROM sub s
    JOIN public.comments c ON c.parent_id = s.id
    WHERE c.file_id = p_file_id
      AND c.is_deleted = false
      AND (p_include_hidden OR c.is_hidden IS NOT TRUE)
  )
  SELECT root_id, count(*)::bigint FROM sub GROUP BY root_id;
$$;

-- Like count + viewer-liked per comment, aggregated in SQL. A comment with
-- 100k likes used to mean 100k rows over the wire; now it's one.
CREATE OR REPLACE FUNCTION get_comment_like_counts(
  p_comment_ids uuid[],
  p_viewer_id   uuid DEFAULT NULL
)
RETURNS TABLE (comment_id uuid, like_count bigint, viewer_liked boolean)
LANGUAGE sql
STABLE
AS $$
  SELECT
    l.comment_id,
    count(*)::bigint,
    bool_or(p_viewer_id IS NOT NULL AND l.user_id = p_viewer_id)
  FROM public.comment_likes l
  WHERE l.comment_id = ANY (p_comment_ids)
  GROUP BY l.comment_id;
$$;

-- Total comments the viewer can see: all non-deleted rows minus hidden
-- subtrees. Hidden threads are rare, so walking just them is cheap even on a
-- file with 100k comments; the outer counts are plain index counts.
CREATE OR REPLACE FUNCTION get_visible_comment_count(
  p_file_id        uuid,
  p_include_hidden boolean DEFAULT false
)
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE hidden_tree AS (
    SELECT c.id
    FROM public.comments c
    WHERE c.file_id = p_file_id
      AND c.is_deleted = false
      AND NOT p_include_hidden
      AND c.is_hidden IS TRUE
    UNION
    SELECT c.id
    FROM public.comments c
    JOIN hidden_tree h ON c.parent_id = h.id
    WHERE c.file_id = p_file_id
      AND c.is_deleted = false
  )
  SELECT
    (SELECT count(*) FROM public.comments c
      WHERE c.file_id = p_file_id AND c.is_deleted = false)::bigint
    - (SELECT count(*) FROM hidden_tree)::bigint;
$$;

-- App server talks with the service role. Do not let anon JWT callers flip
-- p_include_hidden or pull like maps straight from PostgREST.
REVOKE ALL ON FUNCTION get_comment_roots_page(uuid, boolean, int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_reply_subtree_counts(uuid, uuid[], boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_comment_like_counts(uuid[], uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_visible_comment_count(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_comment_roots_page(uuid, boolean, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION get_reply_subtree_counts(uuid, uuid[], boolean) TO service_role;
GRANT EXECUTE ON FUNCTION get_comment_like_counts(uuid[], uuid) TO service_role;
GRANT EXECUTE ON FUNCTION get_visible_comment_count(uuid, boolean) TO service_role;
