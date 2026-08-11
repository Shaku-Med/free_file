-- See migrations/acoustid_recordings.sql for the applied migration.
-- Staging lives in Redis on the VPS, not in SQL.

create table public.acoustid_recordings (
  id uuid not null default gen_random_uuid (),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  acoustid text null,
  recording_mbid text null,
  release_group_mbid text null,
  title text not null default ''::text,
  artists text not null default ''::text,
  album text null,
  duration numeric null,
  cover_art_url text null,
  musicbrainz_url text null,
  constraint acoustid_recordings_pkey primary key (id)
);
