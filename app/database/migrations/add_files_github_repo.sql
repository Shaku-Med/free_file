-- Per-file GitHub repository name (nullable; DB default + app fallbacks via GITHUB_DEFAULT_REPO / GITHUB_REPO — see .env).
--
-- CLIENT / API SAFETY: github_repo must never appear in client-facing query results.
-- - Feed/search/playlist/series RPCs already project explicit columns; do not add f.github_repo there.
-- - Never use RETURNS SETOF public.files or SELECT f.* for authenticated/anon-callable functions that
--   return rows to the app browser — use an explicit column list excluding github_repo (see get_file_for_owner_edit.sql).
-- - Server routes that need it should .select('..., github_repo') only in API loaders that do not serialize it to the client.
alter table public.files
  add column if not exists github_repo text null;

update public.files
set github_repo = 'Memories'
where github_repo is null;
