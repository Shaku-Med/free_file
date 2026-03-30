create table public.files_series_episode_items (
  id uuid not null default gen_random_uuid (),
  file_series_id uuid not null,
  file_episode_id uuid not null,
  owner_id uuid null,
  file_id text null,
  constraint files_series_episode_items_pkey primary key (id),
  constraint files_series_episode_items_file_id_fkey foreign KEY (file_id) references files (unique_id) on update CASCADE on delete CASCADE,
  constraint files_series_episode_items_file_series_id_fkey foreign KEY (file_series_id) references file_series (id) on update CASCADE on delete CASCADE,
  constraint files_series_episode_items_owner_id_fkey foreign KEY (owner_id) references users (id) on update CASCADE on delete CASCADE,
  constraint files_series_episode_items_owner_id_fkey1 foreign KEY (owner_id) references users (id) on update CASCADE on delete CASCADE
) TABLESPACE pg_default;