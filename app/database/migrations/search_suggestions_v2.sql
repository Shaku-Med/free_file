-- Search suggestions v2. Run after search_history.sql. Safe to re-run.
--
-- v1 ranked by raw search_count, so one person repeating a query made it
-- "popular" for everyone. v2 counts each searcher once toward a query, at most
-- once a day toward its trending score, and only suggests a query once enough
-- different people have searched it.
--
-- Search history now lives on the user's device, so nothing here is per user.
-- `searcher` is an HMAC computed by the app; no user id or IP is stored.

alter table public.search_query_stats
  add column if not exists distinct_searchers integer not null default 0,
  add column if not exists score double precision not null default 0,
  add column if not exists score_at timestamptz not null default now();

create table if not exists public.search_query_searchers (
  query            text not null,
  searcher         text not null,
  first_at         timestamptz not null default now(),
  last_counted_at  timestamptz not null default now(),
  primary key (query, searcher)
);

create index if not exists search_query_searchers_last_idx
  on public.search_query_searchers (last_counted_at);

alter table public.search_query_searchers enable row level security;

create or replace function public.log_search_query_v2(
  p_query    text,
  p_searcher text
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_q   text := lower(regexp_replace(btrim(coalesce(p_query, '')), '\s+', ' ', 'g'));
  v_new boolean;
  v_counted boolean;
begin
  if length(v_q) < 2 or length(v_q) > 80 or v_q !~ '[[:alpha:]]' then
    return;
  end if;
  if p_searcher is null or length(p_searcher) < 16 or length(p_searcher) > 128 then
    return;
  end if;

  insert into search_query_searchers (query, searcher)
  values (v_q, p_searcher)
  on conflict (query, searcher) do nothing;
  v_new := found;

  if v_new then
    v_counted := true;
  else
    update search_query_searchers
       set last_counted_at = now()
     where query = v_q
       and searcher = p_searcher
       and last_counted_at < now() - interval '1 day';
    v_counted := found;
  end if;

  if not v_counted then
    return;
  end if;

  -- score decays with a 14 day half life, so trending reflects recent interest.
  insert into search_query_stats as s
    (query, search_count, last_searched_at, distinct_searchers, score, score_at)
  values (v_q, 1, now(), 1, 1, now())
  on conflict (query) do update
    set search_count       = s.search_count + 1,
        last_searched_at   = now(),
        distinct_searchers = s.distinct_searchers + (case when v_new then 1 else 0 end),
        score              = s.score * exp(-ln(2) * extract(epoch from (now() - s.score_at)) / 1209600.0) + 1,
        score_at           = now();
end;
$$;

-- Typed completions only. Prefix matches first, then matches at a word start
-- ("dance" finds "how to dance"), each ordered by live trending score.
create or replace function public.get_search_completions_v2(
  p_query         text,
  p_limit         int default 8,
  p_min_searchers int default 3
)
returns table (query text)
language sql
stable
set search_path = public
as $$
  with norm as (
    select lower(regexp_replace(btrim(coalesce(p_query, '')), '\s+', ' ', 'g')) as q
  ),
  esc as (
    select q, replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') as lq
    from norm
  ),
  ranked as (
    select s.query,
           case when s.query like e.lq || '%' then 0 else 1 end as tier,
           s.score * exp(-ln(2) * extract(epoch from (now() - s.score_at)) / 1209600.0) as live_score
    from search_query_stats s, esc e
    where length(e.q) between 1 and 80
      and s.distinct_searchers >= greatest(p_min_searchers, 1)
      and s.query <> e.q
      and (
        s.query like e.lq || '%'
        or (length(e.q) >= 3 and s.query like '% ' || e.lq || '%')
      )
  )
  select query
  from ranked
  order by tier, live_score desc, query
  limit least(greatest(p_limit, 1), 20);
$$;

revoke all on function public.log_search_query_v2(text, text) from public, anon, authenticated;
revoke all on function public.get_search_completions_v2(text, int, int) from public, anon, authenticated;
grant execute on function public.log_search_query_v2(text, text) to service_role;
grant execute on function public.get_search_completions_v2(text, int, int) to service_role;

-- Optional housekeeping (pg_cron): forget searchers idle for 90 days.
-- select cron.schedule('search-searchers-purge', '17 4 * * *',
--   $$delete from public.search_query_searchers where last_counted_at < now() - interval '90 days'$$);

-- Optional, and irreversible: history is device-local now, so the old
-- server-side copy of everyone's searches no longer serves a purpose.
-- truncate public.user_recent_searches;
