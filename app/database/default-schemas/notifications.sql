create table public.notifications (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  type text not null,
  actor_id uuid not null,
  file_id uuid null,
  comment_id uuid null,
  created_at timestamp with time zone not null default now(),
  read_at timestamp with time zone null,
  expires_at timestamp with time zone null,
  constraint notifications_pkey primary key (id),
  constraint notifications_actor_id_fkey foreign KEY (actor_id) references users (id) on delete CASCADE,
  constraint notifications_comment_id_fkey foreign KEY (comment_id) references comments (id) on delete set null,
  constraint notifications_file_id_fkey foreign KEY (file_id) references files (id) on delete set null,
  constraint notifications_user_id_fkey foreign KEY (user_id) references users (id) on delete CASCADE,
  constraint notifications_type_check check (
    (
      type = any (
        array[
          'file_like'::text,
          'file_comment'::text,
          'comment_reply'::text,
          'comment_like'::text,
          'comment_mention'::text,
          'new_subscriber'::text,
          'channel_upload'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_notifications_user_id on public.notifications using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_notifications_user_read on public.notifications using btree (user_id, read_at) TABLESPACE pg_default;

create index IF not exists idx_notifications_created_at on public.notifications using btree (created_at desc) TABLESPACE pg_default;

create index IF not exists idx_notifications_expires_at on public.notifications using btree (expires_at) TABLESPACE pg_default
where
  (expires_at is not null);