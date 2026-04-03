-- Legacy default when a row has no explicit github_repo (old "Memories" bucket).
-- New uploads set github_repo from the worker (GITHUB_REPO in Go, e.g. MemoriesV2).
alter table public.files
  alter column github_repo set default 'Memories';

update public.files
set github_repo = 'Memories'
where github_repo is null;
