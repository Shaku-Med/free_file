-- Moderation: account enforcement state + audit trail.
-- See docs/Moderation.md. Safe to re-run.

------------------------------------------------------------------------------
-- 1. The single enforcement flag
------------------------------------------------------------------------------
-- ONE column, read by every service that serves bytes (app, GoUpload, loadplay,
-- LoadNodeServer, image loader). Per-service copies of this rule drift, and
-- drift means something keeps serving content after a ban.
--
--   active      full access
--   strike      content removed + counter; account still usable
--   restricted  content unlisted everywhere; no upload/comment/interact.
--               Appealable and EXPIRES.
--   terminated  permanent. Human-confirmed only.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'account_status') then
    create type public.account_status as enum
      ('active', 'strike', 'restricted', 'terminated');
  end if;
end$$;

alter table public.users
  add column if not exists account_status public.account_status
    not null default 'active';

-- When a `restricted` status lapses back to active. NULL = no expiry, which for
-- `restricted` means a human must lift it.
alter table public.users
  add column if not exists status_expires_at timestamptz;

-- Shown to the owner on their profile / studio so a ban is never unexplained.
alter table public.users
  add column if not exists status_reason text;

-- Partial index: the overwhelming majority of rows are 'active', and every read
-- path asks "is this account NOT active?".
create index if not exists idx_users_account_status
  on public.users (account_status)
  where account_status <> 'active';

create index if not exists idx_users_status_expires
  on public.users (status_expires_at)
  where status_expires_at is not null;

------------------------------------------------------------------------------
-- 2. Audit trail
------------------------------------------------------------------------------
-- Every enforcement action is recorded. Without this there is no way to answer
-- "why is this account restricted", no appeal review, and no way to unwind a
-- bad automated run.
create table if not exists public.moderation_actions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,
  file_id       uuid references public.files (id) on delete set null,
  -- 'remove' | 'strike' | 'restrict' | 'terminate' | 'reinstate' | 'appeal'
  action        text not null,
  -- Machine label that triggered it (e.g. 'gore', 'adult', 'violence').
  -- Deliberately NOT used for CSAM — that path never writes here.
  category      text,
  reason        text,
  -- 'system' for automated detection, otherwise the reviewing user's id.
  actor         text not null default 'system',
  -- Raw detector output, for reviewing false positives after the fact.
  evidence      jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists idx_moderation_actions_user
  on public.moderation_actions (user_id, created_at desc);

create index if not exists idx_moderation_actions_actor_time
  on public.moderation_actions (actor, created_at desc);

alter table public.moderation_actions enable row level security;
-- No policies: service-role access only. Moderation history must never be
-- readable by clients.

------------------------------------------------------------------------------
-- 3. Automated-action rate limit
------------------------------------------------------------------------------
-- The classifier is unreliable in BOTH directions (it missed real gore in
-- testing, and this model class false-positives on medical, news, horror and
-- documentary footage). A bad deploy must degrade, not mass-restrict the
-- userbase overnight.
--
-- Returns TRUE when the automated action is within budget. Callers that get
-- FALSE should log and skip the enforcement, leaving it for human review.
create or replace function public.moderation_rate_ok(
  p_max_per_hour integer default 20
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select count(*) < p_max_per_hour
  from public.moderation_actions
  where actor = 'system'
    and action in ('restrict', 'terminate')
    and created_at > now() - interval '1 hour';
$$;

revoke all on function public.moderation_rate_ok(integer) from public, anon, authenticated;

------------------------------------------------------------------------------
-- 4. Expiry sweep
------------------------------------------------------------------------------
-- Restrictions are meant to end. Run on a schedule (pg_cron):
--   select cron.schedule('moderation-expiry','*/15 * * * *',
--     $$select public.expire_account_restrictions();$$);
create or replace function public.expire_account_restrictions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with lapsed as (
    update public.users
       set account_status = 'active',
           status_expires_at = null,
           status_reason = null
     where account_status = 'restricted'
       and status_expires_at is not null
       and status_expires_at <= now()
    returning id
  )
  insert into public.moderation_actions (user_id, action, reason, actor)
  select id, 'reinstate', 'restriction expired', 'system' from lapsed;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_account_restrictions() from public, anon, authenticated;
