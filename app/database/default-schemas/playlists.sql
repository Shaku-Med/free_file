create table public.playlists (
  id uuid not null default gen_random_uuid (),
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  owner_id uuid null,
  title text not null,
  description text null,
  is_public boolean null default true,
  thumbnail_url text null,
  unique_id text not null,
  constraint playlists_pkey1 primary key (id),
  constraint playlists_unique_id_key unique (unique_id),
  constraint playlists_owner_id_fkey foreign KEY (owner_id) references users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_playlists_owner on public.playlists using btree (owner_id) TABLESPACE pg_default;

create index IF not exists idx_playlists_unique on public.playlists using btree (unique_id) TABLESPACE pg_default;