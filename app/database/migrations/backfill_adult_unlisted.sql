-- Backfill: existing adult files get the same treatment new uploads get.
-- Run AFTER file_visibility_and_moderation_lock.sql. Safe to re-run.

------------------------------------------------------------------------------
-- 1. Look before you leap
------------------------------------------------------------------------------
select
  visibility,
  visibility_locked,
  count(*) as files
from public.files
where is_adult = true
group by visibility, visibility_locked
order by visibility, visibility_locked;

------------------------------------------------------------------------------
-- 2. The backfill
------------------------------------------------------------------------------
-- Visibility only ever gets NARROWER here. An adult file the owner already set
-- to private stays private: unlisted is wider than private, so blanket-setting
-- everything to unlisted would hand out links to content that was locked down.
--
--   public   -> unlisted
--   unlisted -> unlisted
--   private  -> private
--
-- Everything adult gets locked either way, which is what stops owners flipping
-- it back in the studio.
update public.files
set
  visibility = case when visibility = 'public' then 'unlisted' else visibility end,
  visibility_locked = true,
  moderation_flag = 'adult',
  -- Restamped so the guard trigger permits the change on rows that are already
  -- locked, and so a re-run is a no-op rather than an error.
  moderation_flagged_at = now(),
  moderation_reviewed_at = null
where is_adult = true
  and (
    visibility = 'public'
    or visibility_locked is distinct from true
    or moderation_flag is distinct from 'adult'
  );

-- is_public is maintained by the trigger, so it flips to false automatically.

------------------------------------------------------------------------------
-- 3. Verify
------------------------------------------------------------------------------
-- Expect zero rows.
select count(*) as adult_still_public
from public.files
where is_adult = true and visibility = 'public';

select count(*) as adult_unlocked
from public.files
where is_adult = true and visibility_locked is distinct from true;

-- Expect nothing widened: no adult file should be unlisted unless it was
-- public before. Sanity check on the totals instead.
select visibility, count(*) as files
from public.files
where is_adult = true
group by visibility
order by visibility;

------------------------------------------------------------------------------
-- 4. Audit trail (optional)
------------------------------------------------------------------------------
-- One row per affected file. Skip it if the volume is large and you would
-- rather not carry the history for a bulk action.
--
-- insert into public.moderation_actions (user_id, file_id, action, category, reason, actor)
-- select owner_id, id, 'flag', 'adult', 'backfill: adult content forced unlisted', 'system'
-- from public.files
-- where is_adult = true and moderation_flag = 'adult';
