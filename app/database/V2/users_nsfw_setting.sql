alter table public.users
  add column if not exists show_nsfw boolean default false;
