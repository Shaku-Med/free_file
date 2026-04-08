-- Processing % for video pipeline (Go worker → webhook → files.processing_progress).
-- Run in Supabase SQL Editor after deploy.

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS processing_progress smallint NULL;

COMMENT ON COLUMN public.files.processing_progress IS '0–100 while upload_status is queued/running; NULL when complete or unknown.';

ALTER TABLE public.files
  DROP CONSTRAINT IF EXISTS files_processing_progress_range;

ALTER TABLE public.files
  ADD CONSTRAINT files_processing_progress_range
  CHECK (
    processing_progress IS NULL
    OR (processing_progress >= 0 AND processing_progress <= 100)
  );

-- Profile tab listing: re-apply get_profile_files from database/V2/get_profile_files.sql
-- so RETURNS TABLE and SELECT include processing_progress.
