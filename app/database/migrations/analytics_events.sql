-- analytics_events: raw event capture for Brozy Studio.
--
-- One row per client emitted event. We keep it intentionally simple so
-- the table can accept any signal we add later without a schema change.
-- Daily rollups happen in SQL views or in a scheduled job once volume
-- justifies it.
--
-- Run in Supabase SQL editor (or via your migration workflow) before
-- deploying studio analytics. Without this table the analytics endpoints
-- still work, they just return zeros for the breakdown timelines.

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  file_id uuid references public.files(id) on delete cascade,
  owner_id uuid,
  actor_id uuid,
  actor_anon_hash text,
  occurred_at timestamptz not null default now(),
  metadata jsonb default '{}'::jsonb
);

-- Hot queries: by owner over a time window, by file over a time window.
create index if not exists analytics_events_owner_time
  on public.analytics_events (owner_id, occurred_at desc);
create index if not exists analytics_events_file_time
  on public.analytics_events (file_id, occurred_at desc);
create index if not exists analytics_events_type_time
  on public.analytics_events (event_type, occurred_at desc);

-- Row level security: only the service role writes / reads through our
-- API. The API itself authorises the request, so we keep RLS strict.
alter table public.analytics_events enable row level security;

drop policy if exists "service_role_full" on public.analytics_events;
create policy "service_role_full"
  on public.analytics_events
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Daily aggregate view per file. Cheap because of the (file_id, occurred_at) index.
create or replace view public.analytics_daily_per_file as
select
  file_id,
  owner_id,
  event_type,
  (occurred_at at time zone 'UTC')::date as day,
  count(*) as count
from public.analytics_events
where file_id is not null
group by file_id, owner_id, event_type, day;

-- Daily aggregate per owner across all their files.
create or replace view public.analytics_daily_per_owner as
select
  owner_id,
  event_type,
  (occurred_at at time zone 'UTC')::date as day,
  count(*) as count
from public.analytics_events
where owner_id is not null
group by owner_id, event_type, day;
