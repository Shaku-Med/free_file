create table public.push_subscriptions (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamp with time zone not null default now(),
  constraint push_subscriptions_pkey primary key (id),
  constraint push_subscriptions_endpoint_unique unique (endpoint),
  constraint push_subscriptions_user_id_fkey foreign KEY (user_id) references users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_push_subscriptions_user_id on public.push_subscriptions using btree (user_id) TABLESPACE pg_default;