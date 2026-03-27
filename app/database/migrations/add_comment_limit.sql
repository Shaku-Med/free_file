-- Add comment_limit column to files table
-- NULL means unlimited comments (default behavior)
-- 0 means comments disabled (same as comments_enabled = false)
-- Any positive integer limits total comments allowed
ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS comment_limit integer NULL;
