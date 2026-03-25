create table public.feed_impressions (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  file_id uuid not null,
  seen_at timestamp with time zone not null default now(),
  constraint feed_impressions_pkey primary key (id),
  constraint feed_impressions_unique unique (user_id, file_id),
  constraint feed_impressions_file_fkey foreign KEY (file_id) references files (id) on delete CASCADE,
  constraint feed_impressions_user_fkey foreign KEY (user_id) references users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_feed_impressions_user on public.feed_impressions using btree (user_id, seen_at desc) TABLESPACE pg_default;

create index IF not exists idx_feed_impressions_user_file on public.feed_impressions using btree (user_id, file_id) TABLESPACE pg_default;