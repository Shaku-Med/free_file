-- Add comments_enabled column to files table
-- Defaults to true so existing files keep comments on
ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS comments_enabled boolean NOT NULL DEFAULT true;
