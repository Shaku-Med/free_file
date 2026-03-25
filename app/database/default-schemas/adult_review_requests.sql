create table public.adult_review_requests (
  id uuid not null default gen_random_uuid (),
  file_id uuid not null,
  user_id uuid not null,
  request_count int not null default 1,
  reason text null,
  status text not null default 'pending',
  response_message text null,
  accepted boolean null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  reviewed_at timestamp with time zone null,
  constraint adult_review_requests_pkey primary key (id),
  constraint adult_review_requests_unique unique (file_id, user_id),
  constraint adult_review_requests_file_fkey foreign key (file_id) references files (id) on delete cascade,
  constraint adult_review_requests_user_fkey foreign key (user_id) references users (id) on delete cascade,
  constraint adult_review_requests_status_check check (status in ('pending', 'accepted', 'denied')),
  constraint adult_review_requests_max_count check (request_count <= 2)
) tablespace pg_default;

create index if not exists idx_adult_review_file on public.adult_review_requests using btree (file_id) tablespace pg_default;

create index if not exists idx_adult_review_user on public.adult_review_requests using btree (user_id) tablespace pg_default;

create index if not exists idx_adult_review_status on public.adult_review_requests using btree (status) tablespace pg_default;
