-- ============================================================
-- Feed signals: the WRITE path the recommendation tables never had.
--
-- get_reel_feed / feed_smart / get_related all READ user_interest_scores,
-- user_creator_affinity and feed_impressions, but nothing in the app ever
-- wrote them - so the For You lane stayed off for everyone (feeds were the
-- same unpersonalized mix per user) and watched reels re-served every
-- session. This adds the tables (if missing) and one batched RPC the app
-- calls as the viewer swipes through reels.
--
-- Weighting: a fast skip records only an impression; ~3s+ of watching bumps
-- the reel's categories and creator; 10s+ bumps them harder. Scores are
-- capped so no single binge pins a category forever.
-- ============================================================

create table if not exists public.user_interest_scores (
  user_id    uuid not null,
  category   text not null,
  score      double precision not null default 0,
  updated_at timestamptz not null default now(),
  constraint user_interest_scores_pkey primary key (user_id, category),
  constraint user_interest_scores_user_fkey foreign key (user_id) references users (id) on delete cascade
);

create index if not exists idx_user_interest_scores_user
  on public.user_interest_scores (user_id, score desc);

create table if not exists public.user_creator_affinity (
  user_id        uuid not null,
  creator_id     uuid not null,
  affinity_score double precision not null default 0,
  updated_at     timestamptz not null default now(),
  constraint user_creator_affinity_pkey primary key (user_id, creator_id),
  constraint user_creator_affinity_user_fkey foreign key (user_id) references users (id) on delete cascade,
  constraint user_creator_affinity_creator_fkey foreign key (creator_id) references users (id) on delete cascade
);

create index if not exists idx_user_creator_affinity_user
  on public.user_creator_affinity (user_id, affinity_score desc);

-- Batched signal recording. p_items: [{ "file_id": uuid, "owner_id": uuid|null,
-- "categories": ["Music", ...], "dwell_ms": 5400 }, ...]. Caller (the app,
-- service role) passes the AUTHENTICATED user id - never a client-supplied one.
create or replace function record_feed_signals(
  p_user_id uuid,
  p_items   jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  itm        jsonb;
  v_file_id  uuid;
  v_owner_id uuid;
  v_dwell_ms numeric;
  v_weight   double precision;
  v_cat      text;
begin
  if p_user_id is null or p_items is null or jsonb_typeof(p_items) <> 'array' then
    return;
  end if;

  for itm in select * from jsonb_array_elements(p_items) limit 50
  loop
    begin
      v_file_id := (itm ->> 'file_id')::uuid;
    exception when others then
      continue;
    end;
    if v_file_id is null then
      continue;
    end if;

    -- Impression: this reel was on screen; the feed's seen-window keys off it.
    insert into feed_impressions (user_id, file_id)
    values (p_user_id, v_file_id)
    on conflict (user_id, file_id) do update set seen_at = now();

    -- Interest/affinity only when the viewer actually watched a bit: a fast
    -- swipe-away is not taste, it is the opposite.
    v_dwell_ms := coalesce((itm ->> 'dwell_ms')::numeric, 0);
    if v_dwell_ms < 3000 then
      continue;
    end if;
    v_weight := case when v_dwell_ms >= 10000 then 2.0 else 1.0 end;

    for v_cat in
      select value from jsonb_array_elements_text(coalesce(itm -> 'categories', '[]'::jsonb)) limit 8
    loop
      if v_cat is null or length(trim(v_cat)) = 0 or length(v_cat) > 100 then
        continue;
      end if;
      insert into user_interest_scores (user_id, category, score, updated_at)
      values (p_user_id, trim(v_cat), v_weight, now())
      on conflict (user_id, category) do update
        set score = least(user_interest_scores.score + excluded.score, 100),
            updated_at = now();
    end loop;

    begin
      v_owner_id := (itm ->> 'owner_id')::uuid;
    exception when others then
      v_owner_id := null;
    end;
    if v_owner_id is not null and v_owner_id <> p_user_id then
      insert into user_creator_affinity (user_id, creator_id, affinity_score, updated_at)
      values (p_user_id, v_owner_id, v_weight, now())
      on conflict (user_id, creator_id) do update
        set affinity_score = least(user_creator_affinity.affinity_score + excluded.affinity_score, 100),
            updated_at = now();
    end if;
  end loop;
end;
$$;

revoke all on function record_feed_signals(uuid, jsonb) from public, anon, authenticated;
grant execute on function record_feed_signals(uuid, jsonb) to service_role;

-- RLS: app uses the service role (bypasses RLS); enabling with owner-only
-- policies locks these tables for the anon/auth keys (custom auth -> denied).
alter table public.user_interest_scores enable row level security;
drop policy if exists user_interest_scores_owner on public.user_interest_scores;
create policy user_interest_scores_owner on public.user_interest_scores
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.user_creator_affinity enable row level security;
drop policy if exists user_creator_affinity_owner on public.user_creator_affinity;
create policy user_creator_affinity_owner on public.user_creator_affinity
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.feed_impressions enable row level security;
drop policy if exists feed_impressions_owner on public.feed_impressions;
create policy feed_impressions_owner on public.feed_impressions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
