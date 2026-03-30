create table public.files (
  id uuid not null default gen_random_uuid (),
  created_at timestamp with time zone null default now(),
  endpoint text not null,
  filename text not null,
  unique_id text not null,
  file_size text null,
  file_type text null,
  up_count numeric null default '0'::numeric,
  down_count numeric null default '0'::numeric,
  is_adult boolean not null default false,
  owner_id uuid not null default '5fe50f8d-a037-4cf1-bfd4-84a32d11167d'::uuid,
  is_public boolean not null default true,
  file_description text null,
  category jsonb[] null default '{}'::jsonb[],
  file_title text null,
  thumbnails jsonb[] null,
  views numeric not null default 0,
  shares numeric not null default 0,
  view_count numeric not null default 0,
  share_count numeric not null default 0,
  is_reel boolean null default false,
  duration numeric null default '0'::numeric,
  upload_status text null default 'complete'::text,
  categories jsonb not null default '[]'::jsonb,
  tags jsonb null default '[]'::jsonb,
  colors jsonb null default '[]'::jsonb,
  metadata jsonb null default '{}'::jsonb,
  comments_enabled boolean not null default true,
  default_thumbnail text null,
  comment_limit integer null,
  is_series_main boolean not null default false,
  file_series_id uuid null,
  file_series_episode_id uuid null,
  is_files_series_item boolean null,
  constraint playlists_pkey primary key (id),
  constraint files_unique_id_key unique (unique_id),
  constraint files_file_series_episode_id_fkey foreign KEY (file_series_episode_id) references files_series_episodes (id) on update CASCADE on delete CASCADE,
  constraint files_file_series_id_fkey foreign KEY (file_series_id) references file_series (id) on update CASCADE on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_playlists_unique_id on public.files using btree (unique_id) TABLESPACE pg_default;

create index IF not exists idx_playlists_created_at on public.files using btree (created_at) TABLESPACE pg_default;

create index IF not exists idx_files_metadata_gin on public.files using gin (metadata jsonb_path_ops) TABLESPACE pg_default;

create index IF not exists idx_files_tags_gin on public.files using gin (tags jsonb_path_ops) TABLESPACE pg_default;

create index IF not exists idx_files_categories_gin on public.files using gin (categories jsonb_path_ops) TABLESPACE pg_default;

create index IF not exists idx_files_text_search on public.files using gin (
  to_tsvector(
    'english'::regconfig,
    (
      (COALESCE(file_title, ''::text) || ' '::text) || COALESCE(file_description, ''::text)
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_files_feed on public.files using btree (
  is_public,
  is_adult,
  created_at desc,
  up_count desc
) TABLESPACE pg_default
where
  (
    (is_public = true)
    and (is_adult = false)
  );

create index IF not exists idx_files_category_gin on public.files using gin (category) TABLESPACE pg_default;

create index IF not exists idx_files_public_feed on public.files using btree (is_public, is_adult) TABLESPACE pg_default
where
  (
    (is_public = true)
    and (is_adult = false)
  );

create index IF not exists idx_files_feed_score on public.files using btree (
  is_public,
  is_adult,
  upload_status,
  created_at desc
) TABLESPACE pg_default
where
  (
    (is_public = true)
    and (is_adult = false)
    and (upload_status = 'complete'::text)
  );

create index IF not exists idx_files_owner on public.files using btree (owner_id) TABLESPACE pg_default;

create index IF not exists idx_files_feed_filter on public.files using btree (created_at desc) TABLESPACE pg_default
where
  (
    (is_public = true)
    and (is_adult = false)
    and (upload_status = 'complete'::text)
  );