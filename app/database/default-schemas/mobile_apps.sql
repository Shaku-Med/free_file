-- Registry of allowed first-party mobile apps.
-- No client secrets live here; PKCE eliminates the need. The row just
-- whitelists which redirect_uris the server will honor for a given app_id.
create table public.mobile_apps (
  id text primary key,                                   -- e.g. 'memories-ios'
  name text not null,
  platform text not null check (platform in ('ios', 'android')),
  allowed_redirects text[] not null default '{}',        -- exact-match whitelist
  active boolean not null default true,
  created_at timestamp with time zone not null default now()
) tablespace pg_default;

-- Seed a default ios + android entry for local dev. Override via migrations in prod.
insert into public.mobile_apps (id, name, platform, allowed_redirects)
values
  ('memories-ios',     'Memories iOS',     'ios',     array['memories://auth/callback']),
  ('memories-android', 'Memories Android', 'android', array['memories://auth/callback'])
on conflict (id) do nothing;
