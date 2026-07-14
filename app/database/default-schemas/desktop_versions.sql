-- Desktop app release registry (Windows / Mac installers hosted on GitHub).
-- `endpoint` is a relative storage path (not a full URL), same idea as files.endpoint.
-- Example: desktop/windows/1.0.1/MemoriesBrozy-Setup.exe
-- Raw download is built server-side from github_repo + release_tag + filename.
--
-- SECURITY: RLS is always on. No direct table policies for anon/authenticated.
-- Reads go through get_active_desktop_version() (security definer).
-- Writes are service_role only (CLI / server), which bypasses RLS.

create table if not exists public.desktop_versions (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('windows', 'mac', 'linux')),
  version text not null,
  endpoint text not null,
  github_repo text not null,
  release_tag text not null,
  filename text not null,
  active boolean not null default true,
  notes text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (platform, version)
) tablespace pg_default;

create index if not exists desktop_versions_platform_active_idx
  on public.desktop_versions (platform, active, created_at desc);

-- At most one active row per platform.
create unique index if not exists desktop_versions_one_active_per_platform
  on public.desktop_versions (platform)
  where (active = true);

comment on table public.desktop_versions is
  'Published desktop builds. endpoint is a relative path; downloads go through /api/desktop/*/download. RLS on; read via get_active_desktop_version().';

comment on column public.desktop_versions.endpoint is
  'Relative path only, e.g. desktop/windows/1.0.1/MemoriesBrozy-Setup.exe';

comment on column public.desktop_versions.github_repo is
  'Repo name only (matches files.github_repo), e.g. Memories — not owner/repo.';

-- ---------------------------------------------------------------------------
-- RLS: always enabled. No policies → clients cannot SELECT/INSERT directly.
-- service_role bypasses RLS for the publish CLI.
-- ---------------------------------------------------------------------------
alter table public.desktop_versions enable row level security;

revoke all on table public.desktop_versions from public, anon, authenticated;
grant select, insert, update, delete on table public.desktop_versions to service_role;

-- ---------------------------------------------------------------------------
-- Read the active build for a platform (windows | mac | linux).
-- Returns one row or none. Safe for the app API to call via rpc().
-- Does NOT expose github_repo to accidental client misuse if you only
-- project the columns you need in the API — the RPC still returns them
-- for the server download path.
-- ---------------------------------------------------------------------------
create or replace function public.get_active_desktop_version(p_platform text)
returns table (
  id uuid,
  platform text,
  version text,
  endpoint text,
  github_repo text,
  release_tag text,
  filename text,
  active boolean,
  notes text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
language sql
stable
security definer
set search_path = public
as $$
  select
    d.id,
    d.platform,
    d.version,
    d.endpoint,
    d.github_repo,
    d.release_tag,
    d.filename,
    d.active,
    d.notes,
    d.created_at,
    d.updated_at
  from public.desktop_versions d
  where d.platform = lower(trim(p_platform))
    and d.active = true
  order by d.created_at desc
  limit 1;
$$;

revoke all on function public.get_active_desktop_version(text) from public;
grant execute on function public.get_active_desktop_version(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Publish helper: deactivate other rows for the platform, then upsert this version.
-- Used by `npm run wv` (service_role). Keeps the "one active per platform" rule.
-- ---------------------------------------------------------------------------
create or replace function public.publish_desktop_version(
  p_platform text,
  p_version text,
  p_endpoint text,
  p_github_repo text,
  p_release_tag text,
  p_filename text,
  p_notes text default null
)
returns public.desktop_versions
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_platform text := lower(trim(p_platform));
  v_version text := trim(both from p_version);
  v_row public.desktop_versions;
begin
  if v_platform not in ('windows', 'mac', 'linux') then
    raise exception 'invalid platform: %', p_platform;
  end if;
  if v_version is null or v_version = '' then
    raise exception 'version is required';
  end if;
  if p_endpoint is null or trim(p_endpoint) = '' then
    raise exception 'endpoint is required';
  end if;
  if p_github_repo is null or trim(p_github_repo) = '' then
    raise exception 'github_repo is required';
  end if;
  if p_release_tag is null or trim(p_release_tag) = '' then
    raise exception 'release_tag is required';
  end if;
  if p_filename is null or trim(p_filename) = '' then
    raise exception 'filename is required';
  end if;

  update public.desktop_versions
  set active = false, updated_at = now()
  where platform = v_platform
    and active = true
    and version is distinct from v_version;

  insert into public.desktop_versions as d (
    platform,
    version,
    endpoint,
    github_repo,
    release_tag,
    filename,
    active,
    notes,
    updated_at
  )
  values (
    v_platform,
    v_version,
    trim(p_endpoint),
    trim(p_github_repo),
    trim(p_release_tag),
    trim(p_filename),
    true,
    p_notes,
    now()
  )
  on conflict (platform, version) do update
    set
      endpoint = excluded.endpoint,
      github_repo = excluded.github_repo,
      release_tag = excluded.release_tag,
      filename = excluded.filename,
      active = true,
      notes = excluded.notes,
      updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.publish_desktop_version(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.publish_desktop_version(text, text, text, text, text, text, text) to service_role;
