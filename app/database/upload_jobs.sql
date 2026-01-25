-- Run in Supabase SQL editor. Stores job status from Go upload server (queued, running, completed, failed).
create table if not exists public.upload_jobs (
  job_id text primary key,
  status text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Optional: RLS. Adjust as needed for your app.
-- alter table public.upload_jobs enable row level security;
