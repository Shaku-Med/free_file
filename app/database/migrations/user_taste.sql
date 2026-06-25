-- Per-user taste profile: accumulated affinity for the things a user engages
-- with. One flexible table keyed by (dimension, value) so the same shape holds
-- category, region, tag and creator affinities. Built up from interactions
-- (likes, saves, long watches) and read back to rank feed candidates.
--
--   dimension = 'category' value = 'music'   weight = 8.4
--   dimension = 'region'   value = 'cn'      weight = 3.1
--   dimension = 'tag'      value = 'drift'   weight = 2.0
create table if not exists public.user_taste (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  dimension text not null,
  value text not null,
  weight double precision not null default 0,
  events integer not null default 0,
  last_event_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint user_taste_unique unique (user_id, dimension, value)
);

create index if not exists user_taste_user_dim_idx
  on public.user_taste (user_id, dimension, weight desc);

-- Add or accumulate one taste signal. Value is normalized (lower + trim) so
-- 'Music' and 'music' collapse. Positive delta for likes/long watches, negative
-- for 'not interested'. The service-role caller scopes p_user_id in code.
create or replace function public.bump_user_taste(
  p_user_id uuid,
  p_dimension text,
  p_value text,
  p_delta double precision
)
returns void
language sql
as $$
  insert into public.user_taste
    (user_id, dimension, value, weight, events, last_event_at, updated_at)
  values
    (p_user_id, p_dimension, lower(btrim(p_value)), p_delta, 1, now(), now())
  on conflict (user_id, dimension, value) do update
    set weight        = public.user_taste.weight + excluded.weight,
        events        = public.user_taste.events + 1,
        last_event_at = now(),
        updated_at    = now();
$$;

-- Read the top taste values for a dimension (e.g. the user's favourite
-- categories or regions), strongest first.
create or replace function public.get_user_taste(
  p_user_id uuid,
  p_dimension text,
  p_limit integer default 20
)
returns table (value text, weight double precision, events integer)
language sql
stable
as $$
  select value, weight, events
  from public.user_taste
  where user_id = p_user_id
    and dimension = p_dimension
    and weight > 0
  order by weight desc
  limit greatest(1, least(coalesce(p_limit, 20), 200));
$$;
