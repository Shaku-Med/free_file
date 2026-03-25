-- ============================================================
-- Subscriptions — user-to-user follow/subscribe relationship
-- ============================================================

create table public.subscriptions (
  id uuid not null default gen_random_uuid (),
  subscriber_id uuid not null,
  channel_id uuid not null,
  created_at timestamp with time zone not null default now(),
  notify boolean not null default true,
  constraint subscriptions_pkey primary key (id),
  constraint unique_subscription unique (subscriber_id, channel_id),
  constraint subscriptions_no_self_follow check (subscriber_id != channel_id),
  constraint subscriptions_subscriber_fkey foreign KEY (subscriber_id) references users (id) on delete CASCADE,
  constraint subscriptions_channel_fkey foreign KEY (channel_id) references users (id) on delete CASCADE
) TABLESPACE pg_default;

-- Who does this user subscribe to?
create index IF not exists idx_subscriptions_subscriber on public.subscriptions using btree (subscriber_id) TABLESPACE pg_default;

-- Who subscribes to this channel?
create index IF not exists idx_subscriptions_channel on public.subscriptions using btree (channel_id) TABLESPACE pg_default;

-- Fast lookup: is user A subscribed to user B?
create index IF not exists idx_subscriptions_pair on public.subscriptions using btree (subscriber_id, channel_id) TABLESPACE pg_default;

-- Chronological listing
create index IF not exists idx_subscriptions_created on public.subscriptions using btree (created_at desc) TABLESPACE pg_default;

-- Notification preference filtering
create index IF not exists idx_subscriptions_notify on public.subscriptions using btree (channel_id, notify) TABLESPACE pg_default
where
  (notify = true);
