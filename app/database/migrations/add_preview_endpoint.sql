-- Storage path of the hover preview MP4 (GoUpload writes hover_preview.mp4
-- beside the thumbnails). Safe to re-run.
--
-- NOT BACKFILLED, on purpose. The path is derivable from default_thumbnail, but
-- deriving it only produces a path, not a file: uploads from before this feature
-- have no hover_preview.mp4 in storage, so every one of those cards would fetch
-- a 404 on hover. The column has to mean "a preview exists", which is only true
-- when the upload pipeline reports one.

alter table public.files
  add column if not exists preview_endpoint text;

create index if not exists idx_files_preview_endpoint
  on public.files (id)
  where preview_endpoint is not null;

select
  count(*) filter (where preview_endpoint is not null) as with_preview,
  count(*) filter (where preview_endpoint is null)     as without_preview
from public.files
where file_type like 'video/%';
