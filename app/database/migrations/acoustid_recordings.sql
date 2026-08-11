-- AcoustID song catalog. Identified recordings are stored once and reused
-- across files via files.acoustid_recording_id. Does NOT touch original_file_id
-- (local audio-fingerprint duplicate linking stays separate).
--
-- Staging / race buffering lives in Redis on the GoUpload VPS
-- (acoustid_jobs + acoustid:result:{upload_id}), not in SQL.

create table if not exists public.acoustid_recordings (
  id uuid not null default gen_random_uuid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  acoustid text null,
  recording_mbid text null,
  release_group_mbid text null,
  title text not null default '',
  artists text not null default '',
  album text null,
  duration numeric null,
  cover_art_url text null,
  musicbrainz_url text null,
  constraint acoustid_recordings_pkey primary key (id)
);

-- Prefer MusicBrainz recording id as the stable unique key when present.
create unique index if not exists acoustid_recordings_recording_mbid_uidx
  on public.acoustid_recordings (recording_mbid)
  where recording_mbid is not null and recording_mbid <> '';

create unique index if not exists acoustid_recordings_acoustid_uidx
  on public.acoustid_recordings (acoustid)
  where acoustid is not null and acoustid <> ''
    and (recording_mbid is null or recording_mbid = '');

create index if not exists acoustid_recordings_title_idx
  on public.acoustid_recordings (lower(title));

alter table public.files
  add column if not exists acoustid_recording_id uuid null
    references public.acoustid_recordings (id) on delete set null;

create index if not exists idx_files_acoustid_recording_id
  on public.files (acoustid_recording_id)
  where acoustid_recording_id is not null;

grant select, insert, update, delete on table public.acoustid_recordings to service_role;

-- Drop legacy pending table if an earlier draft of this migration created it.
drop table if exists public.acoustid_pending;
