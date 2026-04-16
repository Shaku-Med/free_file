-- Short-lived authorization codes for the mobile OAuth (PKCE) flow.
--
-- Row is written when the consent UI calls /api/auth/mobile/authorize after
-- the user explicitly grants the mobile app access. The raw code is returned
-- to the client once and never stored; we only keep its SHA256 hash so that
-- a DB leak cannot be replayed as a valid code.
--
-- Redemption happens at /api/auth/mobile/token. The token endpoint looks up
-- by code_hash, verifies PKCE (sha256(code_verifier) === code_challenge),
-- verifies device_id + redirect_uri still match, and stamps consumed_at so
-- the code cannot be used a second time. Expired or consumed codes are
-- rejected even on the first lookup.
create table public.mobile_auth_codes (
  code_hash text not null,                                  -- sha256(raw_code) hex
  app_id text not null,
  user_id uuid not null,
  device_id text not null,                                  -- opaque client-generated id bound at issue time
  code_challenge text not null,                             -- base64url(sha256(verifier)), PKCE S256
  redirect_uri text not null,                               -- must match mobile_apps.allowed_redirects
  state text null,                                          -- opaque CSRF nonce round-tripped to the client
  expires_at timestamp with time zone not null,             -- typically now() + 2 minutes
  consumed_at timestamp with time zone null,                -- set on successful exchange; also set on failed exchange to prevent retry probing
  created_at timestamp with time zone not null default now(),
  constraint mobile_auth_codes_pkey primary key (code_hash),
  constraint mobile_auth_codes_app_id_fkey foreign KEY (app_id) references mobile_apps (id) on delete cascade,
  constraint mobile_auth_codes_user_id_fkey foreign KEY (user_id) references users (id) on delete cascade
) tablespace pg_default;

-- Sweeps of expired rows and quick lookups during redemption.
create index if not exists idx_mobile_auth_codes_expires_at
  on public.mobile_auth_codes using btree (expires_at) tablespace pg_default;

-- Useful for auditing per-user issuance without scanning the whole table.
create index if not exists idx_mobile_auth_codes_user_id
  on public.mobile_auth_codes using btree (user_id) tablespace pg_default;
