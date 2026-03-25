create table public.likes (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  file_id uuid not null,
  created_at timestamp with time zone null default now(),
  constraint likes_pkey primary key (id),
  constraint unique_user_file_like unique (user_id, file_id),
  constraint likes_file_id_fkey foreign KEY (file_id) references files (id) on delete CASCADE,
  constraint likes_user_id_fkey foreign KEY (user_id) references users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_likes_user on public.likes using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_likes_file on public.likes using btree (file_id) TABLESPACE pg_default;

create index IF not exists idx_likes_created on public.likes using btree (created_at desc) TABLESPACE pg_default;

create index IF not exists idx_likes_file_count on public.likes using btree (file_id) TABLESPACE pg_default;