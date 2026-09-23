-- Player: keep audio playing when the app goes to the background or the screen
-- locks, instead of letting the OS cut it off. Opt in; written by
-- /api/settings PATCH and mirrored into the player cookie so the player reads
-- it without a database round trip.
alter table public.users
  add column if not exists background_playback boolean not null default false;
