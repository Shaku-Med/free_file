-- Server-side playlists
create table if not exists playlists (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  owner_id uuid references users(id) on delete cascade,
  title text not null,
  description text,
  is_public boolean default true,
  thumbnail_url text,
  unique_id text unique not null
);

create table if not exists playlist_items (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid references playlists(id) on delete cascade,
  file_id uuid references files(id) on delete cascade,
  position integer not null,
  added_at timestamptz default now(),
  unique (playlist_id, file_id)
);

create index if not exists idx_playlists_owner on playlists(owner_id);
create index if not exists idx_playlists_unique on playlists(unique_id);
create index if not exists idx_playlist_items_playlist on playlist_items(playlist_id, position);
