-- Debounced + coalesced push notifications.
--
-- Instead of pushing the instant someone likes/comments/subscribes, we queue a
-- pending push that fires ~a minute later. A quick undo (unlike, unsubscribe)
-- cancels it before it ever sends, and multiple events in the window collapse
-- into one push ("Alice and 4 others liked your video") so the device isn't
-- flooded. The in-app notification list is unaffected  this is push only.

create table if not exists public.notification_push_queue (
  id            bigint generated always as identity primary key,
  recipient_id  uuid not null references public.users(id) on delete cascade,
  type          text not null,
  file_id       uuid,
  comment_id    uuid,
  last_actor_id uuid,                 -- newest actor, used for the message
  actor_count   int not null default 1,
  send_after    timestamptz not null,
  created_at    timestamptz not null default now(),
  -- One pending push per (recipient, type, target). NULLS NOT DISTINCT so a
  -- new_subscriber row (null file/comment) still coalesces. (Postgres 15+.)
  constraint notification_push_queue_key
    unique nulls not distinct (recipient_id, type, file_id, comment_id)
);

create index if not exists notification_push_queue_due_idx
  on public.notification_push_queue (send_after);

-- Queue (or coalesce into) a pending push. No-op for self-notifications.
create or replace function public.enqueue_push(
  p_recipient     uuid,
  p_type          text,
  p_actor         uuid,
  p_file          uuid default null,
  p_comment       uuid default null,
  p_delay_seconds int  default 60
)
returns void
language plpgsql
as $$
begin
  if p_recipient is null or p_recipient = p_actor then
    return;
  end if;

  insert into public.notification_push_queue
    (recipient_id, type, file_id, comment_id, last_actor_id, actor_count, send_after)
  values
    (p_recipient, p_type, p_file, p_comment, p_actor, 1, now() + make_interval(secs => p_delay_seconds))
  on conflict on constraint notification_push_queue_key
  do update set
    actor_count   = public.notification_push_queue.actor_count + 1,
    last_actor_id = excluded.last_actor_id;
end;
$$;

-- Cancel a pending push when the action is undone. Decrements the coalesce
-- count and removes the row once it hits zero (so a lone like+unlike sends
-- nothing).
create or replace function public.cancel_push(
  p_recipient uuid,
  p_type      text,
  p_actor     uuid,
  p_file      uuid default null,
  p_comment   uuid default null
)
returns void
language plpgsql
as $$
declare
  v_id    bigint;
  v_count int;
begin
  select id, actor_count into v_id, v_count
  from public.notification_push_queue
  where recipient_id = p_recipient
    and type = p_type
    and file_id is not distinct from p_file
    and comment_id is not distinct from p_comment
  limit 1;

  if v_id is null then
    return;
  end if;
  if v_count <= 1 then
    delete from public.notification_push_queue where id = v_id;
  else
    update public.notification_push_queue set actor_count = actor_count - 1 where id = v_id;
  end if;
end;
$$;

-- Claim + return the due pending pushes (the app builds and sends them). Deleting
-- as we read means a row is sent at most once even if two flushes overlap.
create or replace function public.flush_due_pushes(p_limit int default 50)
returns table (
  recipient_id  uuid,
  type          text,
  file_id       uuid,
  comment_id    uuid,
  last_actor_id uuid,
  actor_count   int
)
language sql
as $$
  delete from public.notification_push_queue q
  where q.id in (
    select id from public.notification_push_queue
    where send_after <= now()
    order by send_after
    limit p_limit
  )
  returning q.recipient_id, q.type, q.file_id, q.comment_id, q.last_actor_id, q.actor_count;
$$;

-- ─── Row Level Security ───────────────────────────────────────────────────
-- Internal push outbox: enqueued, flushed and cancelled ONLY by the server's
-- service-role key (which bypasses RLS). The client never touches it. RLS on
-- with no policy = the public/anon key is fully denied (no read, no write), so
-- a leaked anon key can't see who's getting notified or inject fake pushes.
alter table public.notification_push_queue enable row level security;
