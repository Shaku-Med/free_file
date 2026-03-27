-- Add is_hidden column for file owner to hide comments
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;

-- Cascade soft-delete: marks a comment and all its nested replies as deleted
CREATE OR REPLACE FUNCTION delete_comment_cascade(p_comment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Recursively soft-delete all descendants using a CTE
  WITH RECURSIVE descendants AS (
    SELECT id FROM comments WHERE id = p_comment_id
    UNION ALL
    SELECT c.id FROM comments c JOIN descendants d ON c.parent_id = d.id
  )
  UPDATE comments
  SET is_deleted = true
  WHERE id IN (SELECT id FROM descendants);
END;
$$;

GRANT EXECUTE ON FUNCTION delete_comment_cascade TO authenticated;
