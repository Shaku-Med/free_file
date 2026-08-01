-- Three state file visibility (public / unlisted / private) plus a moderation
-- lock that the owner cannot undo. Safe to re-run.
--
-- See docs/Moderation.md.
--
-- WHY is_public SURVIVES
-- Roughly 20 SQL functions and 125 app call sites filter on `is_public = true`.
-- Rather than rewrite all of them, `visibility` becomes the source of truth and
-- `is_public` is kept in lockstep by a trigger as (visibility = 'public').
-- Unlisted and private therefore drop out of every feed, search and RPC that
-- already exists, with no change to those queries. That is precisely the rule
-- we want: unlisted is reachable by direct link but never listed.

------------------------------------------------------------------------------
-- 1. Visibility
------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'file_visibility') then
    create type public.file_visibility as enum ('public', 'unlisted', 'private');
  end if;
end$$;

alter table public.files
  add column if not exists visibility public.file_visibility;

-- Backfill from the existing boolean before the column goes not null.
update public.files
   set visibility = case when is_public then 'public'::public.file_visibility
                         else 'private'::public.file_visibility end
 where visibility is null;

alter table public.files alter column visibility set default 'public';
alter table public.files alter column visibility set not null;

------------------------------------------------------------------------------
-- 2. Moderation lock
------------------------------------------------------------------------------
-- When true the owner cannot change visibility at all. Everything else about
-- the file (title, description, tags) stays editable, which is deliberate: the
-- point is to stop redistribution, not to punish by freezing the whole record.
alter table public.files
  add column if not exists visibility_locked boolean not null default false;

-- Why it is locked. 'adult' forces unlisted, 'harmful' forces private.
-- Null means no automated moderation flag.
alter table public.files
  add column if not exists moderation_flag text
    check (moderation_flag in ('adult', 'harmful'));

alter table public.files
  add column if not exists moderation_flagged_at timestamptz;

-- Set when a human clears the file. Until then a 'harmful' file stays private.
alter table public.files
  add column if not exists moderation_reviewed_at timestamptz;

-- Raw detector output that caused the flag, for reviewing false positives.
-- The classifier is unreliable in both directions, so the evidence has to be
-- inspectable after the fact.
alter table public.files
  add column if not exists moderation_evidence jsonb;

------------------------------------------------------------------------------
-- 3. The guard
------------------------------------------------------------------------------
-- Enforced in the DATABASE, not just the API. The app already writes with a
-- service role key and there is no RLS on this table, so an API bug that
-- forwards a client supplied field is the realistic attack. This trigger means
-- such a bug still cannot flip a locked file public.
create or replace function public.files_visibility_guard()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'INSERT' then
    -- Accept whichever side the caller supplied; visibility wins if both.
    if new.visibility is null then
      new.visibility := case when coalesce(new.is_public, true)
                             then 'public'::public.file_visibility
                             else 'private'::public.file_visibility end;
    end if;
    new.is_public := (new.visibility = 'public');
    return new;
  end if;

  -- A legacy caller that only knows is_public still works: translate its write
  -- into a visibility change, then apply the same lock rule to it.
  if new.visibility is not distinct from old.visibility
     and new.is_public is distinct from old.is_public then
    new.visibility := case when new.is_public
                           then 'public'::public.file_visibility
                           else 'private'::public.file_visibility end;
  end if;

  -- While a file is locked its visibility is frozen for the OWNER. Two things
  -- are still allowed, and both are moderation actions rather than edits:
  --   * clearing the lock (new.visibility_locked = false), i.e. review passed
  --   * re-flagging, which restamps moderation_flagged_at. Without this an
  --     'adult' file later found to be harmful could not be tightened to
  --     private, because its own lock would block the escalation.
  -- Neither column is writable through any client facing endpoint, so keying
  -- on them does not widen what an attacker can reach.
  if old.visibility_locked
     and new.visibility_locked
     and new.visibility is distinct from old.visibility
     and new.moderation_flagged_at is not distinct from old.moderation_flagged_at then
    raise exception
      'file % visibility is locked by moderation (%)',
      old.id, coalesce(old.moderation_flag, 'unspecified')
      using errcode = 'check_violation';
  end if;

  -- is_public is derived, never authoritative. This also repairs any direct
  -- write that tried to set the two inconsistently.
  new.is_public := (new.visibility = 'public');
  return new;
end;
$$;

drop trigger if exists trg_files_visibility_guard on public.files;
create trigger trg_files_visibility_guard
  before insert or update on public.files
  for each row execute function public.files_visibility_guard();

------------------------------------------------------------------------------
-- 4. Indexes
------------------------------------------------------------------------------
-- Existing partial indexes on (is_public = true) stay correct and now exclude
-- unlisted for free, so they are left alone.

create index if not exists idx_files_visibility
  on public.files (visibility)
  where visibility <> 'public';

-- The human review queue: harmful files that nobody has cleared yet.
create index if not exists idx_files_pending_review
  on public.files (moderation_flagged_at desc)
  where moderation_flag is not null and moderation_reviewed_at is null;

------------------------------------------------------------------------------
-- 5. Moderation entry point
------------------------------------------------------------------------------
-- Applies an automated flag. Kept as a function so the rules for what each flag
-- forces live in ONE place rather than being restated by every caller.
--
--   adult    -> unlisted, locked. Reachable by direct link, never listed.
--   harmful  -> private,  locked. Owner only until a human clears it.
create or replace function public.apply_content_flag(
  p_file_id uuid,
  p_flag    text,
  p_evidence jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_flag not in ('adult', 'harmful') then
    raise exception 'unknown content flag %', p_flag;
  end if;

  update public.files
     set visibility = case when p_flag = 'harmful'
                           then 'private'::public.file_visibility
                           else 'unlisted'::public.file_visibility end,
         visibility_locked = true,
         moderation_flag = p_flag,
         moderation_flagged_at = now(),
         moderation_reviewed_at = null,
         moderation_evidence = coalesce(p_evidence, moderation_evidence)
   where id = p_file_id;
end;
$$;

revoke all on function public.apply_content_flag(uuid, text, jsonb)
  from public, anon, authenticated;

-- Clears a flag after human review and hands control back to the owner.
create or replace function public.clear_content_flag(
  p_file_id uuid,
  p_restore_visibility public.file_visibility default 'private'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.files
     set visibility_locked = false,
         visibility = p_restore_visibility,
         moderation_reviewed_at = now()
   where id = p_file_id;
end;
$$;

revoke all on function public.clear_content_flag(uuid, public.file_visibility)
  from public, anon, authenticated;
