-- Central error log. When something breaks we mint a short ref_code, show it
-- to the user ("Something's wrong. ref: ABC123"), and store the full detail
-- here. A user report of that code lets a dev find the exact incident.
--
-- SECURITY: RLS-locked with no policies, so only the service-role server can
-- read/write it. Never expose rows to the browser. Detail is sanitized at the
-- app layer (no secrets, query strings stripped).
create table if not exists public.error_logs (
  id uuid primary key default gen_random_uuid(),
  ref_code text not null unique,
  created_at timestamptz not null default now(),
  level text not null default 'error',
  source text,                 -- 'app' | 'client' | 'worker' | route name
  message text not null,
  detail jsonb,                -- { stack, context } sanitized
  route text,
  method text,
  status integer,
  user_id uuid,                -- nullable
  ip_hash text,                -- sha256(ip), nullable
  user_agent text
);

create index if not exists idx_error_logs_created on public.error_logs (created_at desc);
create index if not exists idx_error_logs_ref on public.error_logs (ref_code);
create index if not exists idx_error_logs_user on public.error_logs (user_id) where user_id is not null;

alter table public.error_logs enable row level security;
-- Intentionally no policies: service_role only.

-- Optional retention sweep (call from a cron / scheduled task).
create or replace function public.purge_old_error_logs()
returns void
language sql
volatile
security definer
set search_path = public
as $$
  delete from public.error_logs where created_at < now() - interval '90 days';
$$;
revoke all on function public.purge_old_error_logs() from public, anon, authenticated;
grant execute on function public.purge_old_error_logs() to service_role;
