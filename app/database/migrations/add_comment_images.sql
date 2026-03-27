-- Add image support to comments table
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS image_url text NULL,
  ADD COLUMN IF NOT EXISTS image_type text NULL;
