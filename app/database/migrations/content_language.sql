-- ============================================================
-- Content language: ISO 639-3 code ("eng", "cmn", "spa") of the uploader's
-- title/description, detected by the Go worker at processing time. NULL =
-- unknown (too little text to be confident). Feeds the same-language boost in
-- get_related so a Chinese-titled video surfaces to people watching Chinese
-- content instead of getting lost.
--
-- Run this BEFORE re-running V2/get_related_v5.sql (which references the column).
-- Existing rows are backfilled by app/scripts/reembed-files.mjs.
-- ============================================================

alter table public.files
  add column if not exists content_language text null;

-- Defensive sanity check: 2-3 lowercase letters or NULL, nothing else.
alter table public.files
  drop constraint if exists files_content_language_check;
alter table public.files
  add constraint files_content_language_check
  check (content_language is null or content_language ~ '^[a-z]{2,3}$');
