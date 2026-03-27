-- Add default_thumbnail column to files table
-- Stores the GitHub path to a user-selected default thumbnail for the file
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS default_thumbnail text NULL;
