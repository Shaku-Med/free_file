-- Dual storage backend selector (GitHub raw -> Cloudflare R2 migration).
-- storage_backend: 'github' (legacy default) or 'r2'.
-- storage_bucket : R2 bucket name; only meaningful when storage_backend = 'r2'.
--
-- CLIENT / API SAFETY: like github_repo, these columns must NEVER reach the
-- browser. Do not add them to feed/search/series/playlist RPCs, and never
-- SELECT f.* into a client-facing response. Server loaders may read them.
alter table public.files
  add column if not exists storage_backend text not null default 'github',
  add column if not exists storage_bucket text null;

alter table public.files
  drop constraint if exists files_storage_backend_chk;
alter table public.files
  add constraint files_storage_backend_chk
  check (storage_backend in ('github', 'r2'));

-- Existing rows already default to 'github' via the column default; no backfill needed.
