do $migrate_captions$
declare
  col_type text;
begin
  select data_type into col_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'files' and column_name = 'captions';

  if col_type is null then
    alter table public.files add column captions jsonb not null default '[]'::jsonb;
  elsif col_type = 'ARRAY' then
    drop index if exists idx_files_captions_gin;

    -- Add a temp jsonb column, backfill from the text[] column, swap
    alter table public.files add column captions_new jsonb;

    update public.files set captions_new = coalesce(
      (select jsonb_agg(jsonb_build_object('language', x)) from unnest(captions::text[]) as x),
      '[]'::jsonb
    );
    update public.files set captions_new = '[]'::jsonb where captions_new is null;

    alter table public.files drop column captions;
    alter table public.files rename column captions_new to captions;
    alter table public.files alter column captions set default '[]'::jsonb;
    alter table public.files alter column captions set not null;
  end if;
end
$migrate_captions$;

create index if not exists idx_files_captions_gin
  on public.files using gin (captions jsonb_path_ops);

create table if not exists public.caption_tokens (
  token text primary key,
  user_id uuid not null,
  file_id uuid not null,
  unique_id text not null,
  date_folder text not null,
  github_repo text not null,
  language text not null,
  action text not null check (action in ('upload', 'delete')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.caption_tokens
  add column if not exists github_repo text;
update public.caption_tokens set github_repo = '' where github_repo is null;
alter table public.caption_tokens
  alter column github_repo set not null;

create index if not exists idx_caption_tokens_expires
  on public.caption_tokens (expires_at);

drop function if exists public.consume_caption_token(text);

create function public.consume_caption_token(p_token text)
returns table (
  user_id uuid,
  file_id uuid,
  unique_id text,
  date_folder text,
  github_repo text,
  language text,
  action text
)
language sql
volatile
security definer
set search_path = public
as $$
  delete from public.caption_tokens
  where token = p_token
    and expires_at > now()
  returning user_id, file_id, unique_id, date_folder, github_repo, language, action;
$$;

revoke all on function public.consume_caption_token(text) from public, anon, authenticated;
grant execute on function public.consume_caption_token(text) to service_role;

create or replace function public.purge_expired_caption_tokens()
returns void
language sql
volatile
security definer
set search_path = public
as $$
  delete from public.caption_tokens where expires_at < now();
$$;

create table if not exists public.caption_load_tokens (
  token text primary key,
  file_id uuid not null,
  language text not null,
  path text not null,
  github_repo text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists idx_caption_load_tokens_expires
  on public.caption_load_tokens (expires_at);

drop function if exists public.consume_caption_load_token(text);

create function public.consume_caption_load_token(p_token text)
returns table (
  file_id uuid,
  language text,
  path text,
  github_repo text
)
language sql
volatile
security definer
set search_path = public
as $$
  delete from public.caption_load_tokens
  where token = p_token
    and expires_at > now()
  returning file_id, language, path, github_repo;
$$;

revoke all on function public.consume_caption_load_token(text) from public, anon, authenticated;
grant execute on function public.consume_caption_load_token(text) to service_role;

create or replace function public.purge_expired_caption_load_tokens()
returns void
language sql
volatile
security definer
set search_path = public
as $$
  delete from public.caption_load_tokens where expires_at < now();
$$;
