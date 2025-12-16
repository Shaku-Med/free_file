create table public.comments (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  file_id uuid not null,
  content text not null,
  parent_id uuid null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  is_edited boolean not null default false,
  is_deleted boolean not null default false,
  constraint comments_pkey primary key (id),
  constraint comments_user_id_fkey foreign key (user_id) references users (id) on delete cascade,
  constraint comments_file_id_fkey foreign key (file_id) references files (id) on delete cascade,
  constraint comments_parent_id_fkey foreign key (parent_id) references comments (id) on delete cascade,
  constraint comments_content_length check (char_length(content) >= 1 and char_length(content) <= 2000)
) tablespace pg_default;

create index if not exists idx_comments_file on public.comments using btree (file_id) tablespace pg_default;
create index if not exists idx_comments_user on public.comments using btree (user_id) tablespace pg_default;
create index if not exists idx_comments_parent on public.comments using btree (parent_id) tablespace pg_default;
create index if not exists idx_comments_created on public.comments using btree (created_at desc) tablespace pg_default;
create index if not exists idx_comments_file_created on public.comments using btree (file_id, created_at desc) tablespace pg_default;

create or replace function update_comments_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_comments_updated_at_trigger
before update on public.comments
for each row
execute function update_comments_updated_at();

