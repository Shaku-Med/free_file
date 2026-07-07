-- Privacy control: user can pause watch history recording.
-- Read through isAuthenticated() field selection; written only by /api/settings PATCH.
alter table public.users
  add column if not exists history_paused boolean not null default false;
