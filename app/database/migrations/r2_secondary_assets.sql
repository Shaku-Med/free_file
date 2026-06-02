-- Dual-backend (GitHub -> R2) for secondary assets: profile pics, comment
-- images, captions. Same model as files.storage_backend. 'github' default so
-- existing rows keep resolving from GitHub; new uploads set 'r2'.
--
-- CLIENT / API SAFETY: like github_repo, storage_backend must not be returned
-- to the browser in feed/profile/comment payloads. Server routes only.

-- Profile pictures: users row carries the backend for its profile_pic path.
alter table public.users
  add column if not exists storage_backend text not null default 'github';
alter table public.users
  drop constraint if exists users_storage_backend_chk;
alter table public.users
  add constraint users_storage_backend_chk check (storage_backend in ('github', 'r2'));

-- Comment images: the comment row + the upload-repo mapping table both carry it.
alter table public.comments
  add column if not exists storage_backend text not null default 'github';
alter table public.comments
  drop constraint if exists comments_storage_backend_chk;
alter table public.comments
  add constraint comments_storage_backend_chk check (storage_backend in ('github', 'r2'));

alter table public.comment_image_upload_repos
  add column if not exists storage_backend text not null default 'github';
alter table public.comment_image_upload_repos
  drop constraint if exists ciur_storage_backend_chk;
alter table public.comment_image_upload_repos
  add constraint ciur_storage_backend_chk check (storage_backend in ('github', 'r2'));

-- ── Captions: child assets that live under a video's folder, so they follow
-- the parent file's backend. The backend is carried on the token at mint time
-- and returned by the consume RPCs. ──────────────────────────────────────────
alter table public.caption_tokens
  add column if not exists storage_backend text not null default 'github';
alter table public.caption_load_tokens
  add column if not exists storage_backend text not null default 'github';

drop function if exists public.consume_caption_token(text);
create function public.consume_caption_token(p_token text)
returns table (
  user_id uuid,
  file_id uuid,
  unique_id text,
  date_folder text,
  github_repo text,
  storage_backend text,
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
  returning user_id, file_id, unique_id, date_folder, github_repo, storage_backend, language, action;
$$;
revoke all on function public.consume_caption_token(text) from public, anon, authenticated;
grant execute on function public.consume_caption_token(text) to service_role;

drop function if exists public.consume_caption_load_token(text);
create function public.consume_caption_load_token(p_token text)
returns table (
  file_id uuid,
  language text,
  path text,
  github_repo text,
  storage_backend text
)
language sql
volatile
security definer
set search_path = public
as $$
  delete from public.caption_load_tokens
  where token = p_token
    and expires_at > now()
  returning file_id, language, path, github_repo, storage_backend;
$$;
revoke all on function public.consume_caption_load_token(text) from public, anon, authenticated;
grant execute on function public.consume_caption_load_token(text) to service_role;
