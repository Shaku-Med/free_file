-- Storage path of the hover preview MP4 (GoUpload writes hover_preview.mp4
-- beside the thumbnails). Null when the upload predates the feature or the
-- encode failed. Safe to re-run.

alter table public.files
  add column if not exists preview_endpoint text;

-- Backfill for uploads that already have thumbnails: the preview sits in the
-- same directory as default_thumbnail. Rows that never got one will 404 on
-- hover and simply show no preview, so this is safe to apply broadly.
--
-- Restricted to videos: images and reels never get a hover preview.
update public.files
set preview_endpoint =
      regexp_replace(default_thumbnail, '[^/]+$', 'hover_preview.mp4')
where preview_endpoint is null
  and default_thumbnail is not null
  and default_thumbnail like '%/%'
  and coalesce(is_reel, false) = false
  and file_type like 'video/%';

create index if not exists idx_files_preview_endpoint
  on public.files (id)
  where preview_endpoint is not null;

select
  count(*) filter (where preview_endpoint is not null) as with_preview,
  count(*) filter (where preview_endpoint is null)     as without_preview
from public.files
where file_type like 'video/%' and coalesce(is_reel, false) = false;
