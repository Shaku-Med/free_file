-- =============================================================================
-- Comments: file-level settings + owner moderation (idempotent)
-- Run once on Supabase/Postgres. Safe to re-run (IF NOT EXISTS / OR REPLACE).
--
-- files.comments_enabled   — owner can turn comments on/off (default on)
-- files.comment_limit      — NULL = unlimited; 0 = no new comments; N = cap
-- comments.is_hidden       — owner can hide a comment from other viewers
-- delete_comment_cascade   — soft-delete a comment and all nested replies
-- =============================================================================

-- File columns
ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS comments_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS comment_limit integer NULL;

COMMENT ON COLUMN public.files.comment_limit IS 'NULL = unlimited comments; 0 = no comments allowed; positive integer = max non-deleted comments';

-- Owner hide flag
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;

-- Cascade soft-delete (parent delete removes entire reply subtree)
CREATE OR REPLACE FUNCTION public.delete_comment_cascade(p_comment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  WITH RECURSIVE descendants AS (
    SELECT id FROM public.comments WHERE id = p_comment_id
    UNION ALL
    SELECT c.id FROM public.comments c
    INNER JOIN descendants d ON c.parent_id = d.id
  )
  UPDATE public.comments
  SET is_deleted = true, updated_at = now()
  WHERE id IN (SELECT id FROM descendants);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_comment_cascade(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_comment_cascade(uuid) TO service_role;
