-- Interface: snap draggable floats (mini player, upload pill) to screen corners
-- and avoid leaving them in the center. Opt-in; written by /api/settings PATCH.
alter table public.users
  add column if not exists snap_floats_to_corners boolean not null default false;
