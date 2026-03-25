create table public.playlist_items (
  id uuid not null default gen_random_uuid (),
  playlist_id uuid null,
  file_id uuid null,
  position integer not null,
  added_at timestamp with time zone null default now(),
  constraint playlist_items_pkey primary key (id),
  constraint playlist_items_playlist_id_file_id_key unique (playlist_id, file_id),
  constraint playlist_items_file_id_fkey foreign KEY (file_id) references files (id) on delete CASCADE,
  constraint playlist_items_playlist_id_fkey foreign KEY (playlist_id) references playlists (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_playlist_items_playlist on public.playlist_items using btree (playlist_id, "position") TABLESPACE pg_default;