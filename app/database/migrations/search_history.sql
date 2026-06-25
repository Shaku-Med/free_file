-- Frequently-searched + per-user recent searches (YouTube-style suggestions).
--
-- Two LEAN upsert tables (no per-event row growth): one global frequency
-- counter keyed by the normalized query, one per-user recent list. Both are
-- bounded by the number of DISTINCT queries, so they stay small.

create table if not exists public.search_query_stats (
  query             text primary key,            -- normalized: lower(btrim(...))
  search_count      bigint not null default 1,
  last_searched_at  timestamptz not null default now()
);

-- Popularity ordering + prefix ("foo%") matching for typeahead.
create index if not exists search_query_stats_count_idx
  on public.search_query_stats (search_count desc);
create index if not exists search_query_stats_prefix_idx
  on public.search_query_stats (query text_pattern_ops);

create table if not exists public.user_recent_searches (
  user_id           uuid not null references public.users(id) on delete cascade,
  query             text not null,               -- normalized
  last_searched_at  timestamptz not null default now(),
  primary key (user_id, query)
);

create index if not exists user_recent_searches_recent_idx
  on public.user_recent_searches (user_id, last_searched_at desc);

-- Record a submitted search: bump the global counter and the user's recent list.
create or replace function public.log_search_query(
  p_user_id uuid,
  p_query   text
)
returns void
language plpgsql
as $$
declare
  v_q text := lower(btrim(coalesce(p_query, '')));
begin
  if length(v_q) < 2 or length(v_q) > 80 then
    return;
  end if;

  insert into public.search_query_stats (query, search_count, last_searched_at)
  values (v_q, 1, now())
  on conflict (query)
  do update set search_count = public.search_query_stats.search_count + 1,
                last_searched_at = now();

  if p_user_id is not null then
    insert into public.user_recent_searches (user_id, query, last_searched_at)
    values (p_user_id, v_q, now())
    on conflict (user_id, query)
    do update set last_searched_at = now();
  end if;
end;
$$;

-- Completions for the navbar dropdown.
--   empty p_query  -> user's recent searches ('recent') + globally popular ('popular')
--   typed  p_query -> popularity-ranked prefix matches ('match')
create or replace function public.get_search_completions(
  p_user_id uuid default null,
  p_query   text default null,
  p_limit   int  default 10
)
returns table (query text, kind text)
language sql
stable
as $$
  with norm as (
    select lower(btrim(coalesce(p_query, ''))) as q
  ),
  recent as (
    select urs.query, urs.last_searched_at
    from public.user_recent_searches urs, norm
    where norm.q = '' and p_user_id is not null and urs.user_id = p_user_id
    order by urs.last_searched_at desc
    limit p_limit
  ),
  popular_empty as (
    select s.query, s.search_count
    from public.search_query_stats s, norm
    where norm.q = '' and s.query not in (select r.query from recent r)
    order by s.search_count desc, s.last_searched_at desc
    limit p_limit
  ),
  matches as (
    select s.query, s.search_count
    from public.search_query_stats s, norm
    where norm.q <> '' and s.query like norm.q || '%'
    order by s.search_count desc, s.last_searched_at desc
    limit p_limit
  )
  select x.query, x.kind
  from (
    select r.query, 'recent'::text  as kind, 0 as prio, extract(epoch from r.last_searched_at) as metric from recent r
    union all
    select p.query, 'popular'::text as kind, 1 as prio, p.search_count::double precision           from popular_empty p
    union all
    select m.query, 'match'::text   as kind, 2 as prio, m.search_count::double precision           from matches m
  ) x
  order by x.prio asc, x.metric desc
  limit greatest(p_limit, 1) * 2;
$$;

-- Remove one of the signed-in user's recent searches (the dropdown "x").
create or replace function public.delete_recent_search(
  p_user_id uuid,
  p_query   text
)
returns void
language sql
as $$
  delete from public.user_recent_searches
  where user_id = p_user_id and query = lower(btrim(coalesce(p_query, '')));
$$;
