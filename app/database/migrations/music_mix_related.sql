-- Music Mix: item-item co-occurrence ("people who played A also played B").
--
-- WHY CO-OCCURRENCE AND NOT GENRE: a category tag says a track IS amapiano, it
-- does not say WHICH amapiano tracks belong together. Behaviour does. This is
-- the same signal YouTube/Spotify lean on for radio/mix, just computed in
-- Postgres instead of a learned embedding.
--
-- SPLIT OF WORK (the "is it a cron job?" answer):
--   * BATCH (this file)  : recompute the pair scores periodically. Expensive.
--   * ONLINE (API route) : look up the seed's neighbours, filter, diversify.
-- There is no stored per-song playlist, and no recursion — a mix is one lookup
-- plus ranking, so it can never loop into another song's mix.
--
-- Safe to re-run.

------------------------------------------------------------------------------
-- 1. Precomputed neighbours
------------------------------------------------------------------------------
create table if not exists public.music_related (
  source_file_id  uuid not null references public.files (id) on delete cascade,
  related_file_id uuid not null references public.files (id) on delete cascade,
  -- Cosine-normalised co-occurrence. Raw counts would just rank the globally
  -- popular tracks under every seed; dividing by sqrt(plays_a * plays_b) asks
  -- "unusually often TOGETHER" instead of "often at all".
  score           double precision not null,
  co_count        integer not null,
  computed_at     timestamptz not null default now(),
  primary key (source_file_id, related_file_id)
);

create index if not exists idx_music_related_source_score
  on public.music_related (source_file_id, score desc);

alter table public.music_related enable row level security;
-- No policies: server-side (service role) access only, like the other
-- recommendation tables. Nothing here should be readable by anon directly.

------------------------------------------------------------------------------
-- 2. The batch job
------------------------------------------------------------------------------
-- Tunables are arguments so they can be adjusted without editing the function:
--   p_min_co       - ignore pairs seen fewer times than this (noise floor).
--                    Keep at 1 while the platform is small, raise to 2-3 later.
--   p_top_n        - neighbours kept per seed.
--   p_max_per_user - skip absurdly large histories; one bot/power user would
--                    otherwise dominate every pair (and the self-join is
--                    quadratic in a user's track count).
drop function if exists public.rebuild_music_related(integer, integer, integer);
create or replace function public.rebuild_music_related(
  p_min_co       integer default 1,
  p_top_n        integer default 40,
  p_max_per_user integer default 500
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  create temp table _mix_plays on commit drop as
  with eligible as (
    select
      h.user_id,
      -- Collapse re-uploads/covers that share one audio fingerprint into a
      -- single logical track, so the same song can't be its own neighbour
      -- and duplicates don't split the co-occurrence signal.
      coalesce(f.original_file_id, f.id) as track_id
    from public.user_watch_history h
    join public.files f on f.id = h.file_id
    where f.is_music = true
      and f.is_public = true
      and f.is_adult = false
      and coalesce(f.upload_status, 'complete') = 'complete'
  ),
  deduped as (
    select distinct user_id, track_id from eligible
  ),
  sized as (
    select user_id, count(*) as n from deduped group by user_id
  )
  select d.user_id, d.track_id
  from deduped d
  join sized s on s.user_id = d.user_id
  where s.n between 2 and p_max_per_user;

  create index on _mix_plays (user_id);

  create temp table _mix_counts on commit drop as
  select track_id, count(*)::double precision as n
  from _mix_plays
  group by track_id;

  create index on _mix_counts (track_id);

  -- Rebuild wholesale. The table is a derived cache, so a clean swap avoids
  -- stale pairs lingering when a track is unpublished or deleted.
  delete from public.music_related;

  insert into public.music_related (source_file_id, related_file_id, score, co_count)
  select source_file_id, related_file_id, score, co_count
  from (
    select
      p.source_file_id,
      p.related_file_id,
      p.co / sqrt(ca.n * cb.n) as score,
      p.co::integer            as co_count,
      row_number() over (
        partition by p.source_file_id
        order by p.co / sqrt(ca.n * cb.n) desc, p.co desc
      ) as rn
    from (
      select a.track_id as source_file_id,
             b.track_id as related_file_id,
             count(*)::double precision as co
      from _mix_plays a
      join _mix_plays b
        on a.user_id = b.user_id
       and a.track_id <> b.track_id
      group by a.track_id, b.track_id
    ) p
    join _mix_counts ca on ca.track_id = p.source_file_id
    join _mix_counts cb on cb.track_id = p.related_file_id
    where p.co >= p_min_co
  ) ranked
  where rn <= p_top_n;

  select count(*) into v_rows from public.music_related;
  return v_rows;
end;
$$;

revoke all on function public.rebuild_music_related(integer, integer, integer) from public;
revoke all on function public.rebuild_music_related(integer, integer, integer) from anon, authenticated;

------------------------------------------------------------------------------
-- 3. Scheduling
------------------------------------------------------------------------------
-- Run it once now to seed the table:
--     select public.rebuild_music_related();
--
-- Then schedule it. On Supabase, enable pg_cron (Database → Extensions) and:
--     select cron.schedule(
--       'rebuild-music-related',
--       '17 4 * * *',                       -- 04:17 UTC daily, off-peak
--       $$select public.rebuild_music_related();$$
--     );
--
-- Nightly is plenty: taste data moves slowly, and the ONLINE half of the mix
-- (the API route) is what reacts instantly to what a listener just played.
