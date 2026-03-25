create table public.feed_history (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  file_id uuid not null,
  seen_at timestamp with time zone not null default now(),
  constraint feed_history_pkey primary key (id),
  constraint feed_history_unique unique (user_id, file_id),
  constraint feed_history_file_fkey foreign KEY (file_id) references files (id) on delete CASCADE,
  constraint feed_history_user_fkey foreign KEY (user_id) references users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_feed_history_user on public.feed_history using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_feed_history_user_file on public.feed_history using btree (user_id, file_id) TABLESPACE pg_default;

create index IF not exists idx_feed_history_seen on public.feed_history using btree (seen_at) TABLESPACE pg_default;