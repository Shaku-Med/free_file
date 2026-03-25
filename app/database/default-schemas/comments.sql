create table public.comments (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  file_id uuid not null,
  content text not null,
  parent_id uuid null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  is_edited boolean not null default false,
  is_deleted boolean not null default false,
  gif_id text null,
  gif_url text null,
  gif_preview_url text null,
  constraint comments_pkey primary key (id),
  constraint comments_id_key unique (id),
  constraint comments_file_id_fkey foreign KEY (file_id) references files (id) on delete CASCADE,
  constraint comments_parent_id_fkey foreign KEY (parent_id) references comments (id) on delete CASCADE,
  constraint comments_user_id_fkey foreign KEY (user_id) references users (id) on delete CASCADE,
  constraint comments_content_or_gif check (
    (
      (
        (
          TRIM(
            both
            from
              COALESCE(content, ''::text)
          ) <> ''::text
        )
        and (
          char_length(
            TRIM(
              both
              from
                content
            )
          ) <= 2000
        )
      )
      or (
        (gif_id is not null)
        and (
          TRIM(
            both
            from
              COALESCE(gif_id, ''::text)
          ) <> ''::text
        )
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_comments_file on public.comments using btree (file_id) TABLESPACE pg_default;

create index IF not exists idx_comments_user on public.comments using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_comments_parent on public.comments using btree (parent_id) TABLESPACE pg_default;

create index IF not exists idx_comments_created on public.comments using btree (created_at desc) TABLESPACE pg_default;

create index IF not exists idx_comments_file_created on public.comments using btree (file_id, created_at desc) TABLESPACE pg_default;

create index IF not exists idx_comments_file_count on public.comments using btree (file_id) TABLESPACE pg_default
where
  (is_deleted = false);

create trigger update_comments_updated_at_trigger BEFORE
update on comments for EACH row
execute FUNCTION update_comments_updated_at ();