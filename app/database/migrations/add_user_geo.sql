-- Geo + IP for the user's most recent app session. Updated (throttled) from
-- the root loader, and on signup/login. Powers localized recommendations and,
-- later, timezone-aware birthday wishes. geo_updated_at gates how often we
-- refresh so we never write on every request.
alter table public.users
  add column if not exists last_ip text,
  add column if not exists geo_country text,         -- ISO code, e.g. US
  add column if not exists geo_country_name text,     -- e.g. United States
  add column if not exists geo_region text,           -- e.g. NY
  add column if not exists geo_city text,              -- e.g. Staten Island
  add column if not exists geo_timezone text,          -- e.g. America/New_York
  add column if not exists geo_lat double precision,
  add column if not exists geo_lon double precision,
  add column if not exists geo_updated_at timestamp with time zone;

create index if not exists users_geo_country_idx on public.users (geo_country);
