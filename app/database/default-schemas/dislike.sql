create table public.dislike (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  file_id uuid not null,
  created_at timestamp with time zone null default now(),
  constraint dislike_pkey primary key (id),
  constraint unique_user_file_dislike unique (user_id, file_id),
  constraint dislike_file_id_fkey foreign KEY (file_id) references files (id) on delete CASCADE,
  constraint dislike_user_id_fkey foreign KEY (user_id) references users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_dislike_user on public.dislike using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_dislike_file on public.dislike using btree (file_id) TABLESPACE pg_default;

create index IF not exists idx_dislike_created on public.dislike using btree (created_at desc) TABLESPACE pg_default;

create index IF not exists idx_dislike_file_count on public.dislike using btree (file_id) TABLESPACE pg_default;