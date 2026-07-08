-- Creator can pin one comment to the top of a file's thread.
alter table public.comments
  add column if not exists is_pinned boolean not null default false;

-- Fast "the pinned comment for this file" lookup (at most one row per file).
create index if not exists idx_comments_file_pinned
  on public.comments (file_id)
  where is_pinned = true;

-- Pin/unpin, file-owner only, atomic, one pinned per file. Server passes
-- p_user_id from the verified session. Only top-level, non-deleted comments
-- that belong to the file can be pinned.
create or replace function public.set_pinned_comment(
  p_file_id uuid,
  p_comment_id uuid,
  p_user_id uuid,
  p_pinned boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select owner_id into v_owner from files where id = p_file_id;
  if v_owner is null or v_owner <> p_user_id then
    return false;
  end if;

  if not exists (
    select 1 from comments
    where id = p_comment_id
      and file_id = p_file_id
      and parent_id is null
      and coalesce(is_deleted, false) = false
  ) then
    return false;
  end if;

  -- At most one pinned comment per file.
  update comments set is_pinned = false where file_id = p_file_id and is_pinned = true;
  if p_pinned then
    update comments set is_pinned = true where id = p_comment_id;
  end if;
  return true;
end;
$$;

revoke all on function public.set_pinned_comment(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_pinned_comment(uuid, uuid, uuid, boolean) to service_role;
