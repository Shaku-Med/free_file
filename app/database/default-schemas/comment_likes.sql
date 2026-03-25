create table public.comment_likes (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  comment_id uuid not null,
  created_at timestamp with time zone not null default now(),
  constraint comment_likes_pkey primary key (id),
  constraint comment_likes_user_comment_unique unique (user_id, comment_id),
  constraint comment_likes_comment_id_fkey foreign KEY (comment_id) references comments (id) on delete CASCADE,
  constraint comment_likes_user_id_fkey foreign KEY (user_id) references users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_comment_likes_comment on public.comment_likes using btree (comment_id) TABLESPACE pg_default;

create index IF not exists idx_comment_likes_user on public.comment_likes using btree (user_id) TABLESPACE pg_default;