-- Restore a file's real visibility when a flag is cleared. Safe to re-run.
--
-- apply_content_flag overwrote visibility without remembering what it was, so
-- clearing a flag had nothing to restore and fell back to 'private'. A public
-- video that got flagged and then cleared on appeal stayed hidden.

alter table public.files
  add column if not exists visibility_before_flag public.file_visibility;

------------------------------------------------------------------------------
-- Apply: remember the pre-flag visibility
------------------------------------------------------------------------------
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
     set
         -- Only capture on the FIRST flag. Re-flagging (adult escalating to
         -- harmful) must not overwrite it with the already-forced value.
         visibility_before_flag = coalesce(visibility_before_flag, visibility),
         visibility = case when p_flag = 'harmful'
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

------------------------------------------------------------------------------
-- Clear: hand control back, restored to what the owner had
------------------------------------------------------------------------------
-- Used when a human reviews an appeal and the file is fine. Restores the
-- pre-flag visibility, so a video that was public goes straight back to public.
-- Falls back to public only when nothing was recorded (flagged before this
-- migration); an explicit p_restore_visibility still wins.
create or replace function public.clear_content_flag(
  p_file_id uuid,
  p_restore_visibility public.file_visibility default null
)
returns public.file_visibility
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restored public.file_visibility;
begin
  update public.files
     set visibility = coalesce(
           p_restore_visibility,
           visibility_before_flag,
           'public'::public.file_visibility
         ),
         visibility_locked = false,
         visibility_before_flag = null,
         moderation_flag = null,
         moderation_reviewed_at = now()
   where id = p_file_id
   returning visibility into v_restored;

  return v_restored;
end;
$$;

revoke all on function public.clear_content_flag(uuid, public.file_visibility)
  from public, anon, authenticated;

------------------------------------------------------------------------------
-- Backfill
------------------------------------------------------------------------------
-- Files already flagged have no recorded original. Adult ones were forced from
-- public to unlisted by the earlier backfill, so public is the right answer for
-- them. Harmful ones are left null: those were never mass-migrated and a human
-- should decide.
update public.files
   set visibility_before_flag = 'public'
 where moderation_flag = 'adult'
   and visibility_before_flag is null;

select
  count(*) filter (where moderation_flag is not null) as flagged,
  count(*) filter (where visibility_before_flag is not null) as with_restore_point
from public.files;
