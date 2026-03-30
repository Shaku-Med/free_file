create table public.files_series_episodes (
  id uuid not null default gen_random_uuid (),
  feed_series_id uuid not null,
  owner_id uuid not null,
  episode_name text not null,
  episode_number numeric null,
  constraint files_series_episodes_pkey primary key (id),
  constraint files_series_episodes_feed_series_id_fkey foreign KEY (feed_series_id) references file_series (id) on update CASCADE on delete CASCADE,
  constraint files_series_episodes_owner_id_fkey foreign KEY (owner_id) references users (id) on update CASCADE on delete CASCADE
) TABLESPACE pg_default;