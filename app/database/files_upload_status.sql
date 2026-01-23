alter table public.files
  add column if not exists upload_status text default 'completed';
