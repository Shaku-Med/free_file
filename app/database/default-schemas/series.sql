create table public.series (
  id uuid not null default gen_random_uuid(),
  created_at timestamptz null default now(),
  updated_at timestamptz null default now(),
  owner_id uuid not null,
  title text not null,
  description text null,
  thumbnail_url text null,
  unique_id text not null,
  is_public boolean not null default true,
  constraint series_pkey primary key (id),
  constraint series_unique_id_key unique (unique_id),
  constraint series_owner_id_fkey foreign key (owner_id) references public.users (id) on delete cascade,
  constraint series_title_length check (char_length(title) <= 100),
  constraint series_desc_length check (description is null or char_length(description) <= 1000)
) tablespace pg_default;

create index if not exists idx_series_owner on public.series using btree (owner_id);
create index if not exists idx_series_unique_id on public.series using btree (unique_id);

-- files additions (in files table):
-- series_id      uuid    NULL FK → series.id ON DELETE SET NULL
-- season_number  integer NULL DEFAULT 1
-- episode_number integer NULL
-- is_series_main boolean NOT NULL DEFAULT false
--   true  = this file is the series cover/main, shown in feeds
--   false = sub-episode, hidden from feeds, search, recommendations
