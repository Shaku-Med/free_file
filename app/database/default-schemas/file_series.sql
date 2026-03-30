create table public.file_series (
  id uuid not null default gen_random_uuid (),
  file_id text not null default ''::text,
  owner_id uuid not null,
  constraint file_series_pkey primary key (id),
  constraint file_series_file_id_key unique (file_id),
  constraint file_series_file_id_fkey foreign KEY (file_id) references files (unique_id) on update CASCADE on delete CASCADE,
  constraint file_series_owner_id_fkey foreign KEY (owner_id) references users (id) on update CASCADE on delete CASCADE
) TABLESPACE pg_default;