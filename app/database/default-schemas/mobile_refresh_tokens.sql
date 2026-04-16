-- Rotating refresh tokens for the mobile OAuth flow.
--
-- Every successful code exchange or refresh grant issues a NEW refresh token
-- and revokes (not deletes) the previous row in the same family. The raw
-- token is returned to the client exactly once; the DB only stores its
-- SHA256 hash. This means a leaked DB cannot be used to impersonate users
-- without also brute-forcing the pre-image (infeasible for 32 random bytes).
--
-- family_id groups every refresh token ever derived from a single original
-- grant. parent_hash points at the previous link in the chain. On any
-- attempt to refresh with a token that has already been rotated away, the
-- server revokes the ENTIRE family (set revoked_at on all siblings with
-- revoke_reason = 'family_replay'). This is the standard rotating-refresh
-- detection: a legitimate client only ever holds the newest token, so a
-- replay means an attacker captured an older one.
create table public.mobile_refresh_tokens (
  token_hash text not null,                                 -- sha256(raw_refresh_token) hex
  app_id text not null,
  user_id uuid not null,
  device_id text not null,                                  -- bound at issue; rotation must keep the same device_id
  family_id uuid not null default gen_random_uuid (),       -- shared across all rotations of one grant
  parent_hash text null,                                    -- token_hash of the predecessor, null for the root of the family
  expires_at timestamp with time zone not null,             -- absolute expiry (e.g. now() + 60 days); not extended on rotation
  revoked_at timestamp with time zone null,                 -- set on normal rotation or on family kill
  revoke_reason text null,                                  -- 'rotated' | 'family_replay' | 'user_logout' | 'admin'
  created_at timestamp with time zone not null default now(),
  last_used_at timestamp with time zone null,
  constraint mobile_refresh_tokens_pkey primary key (token_hash),
  constraint mobile_refresh_tokens_app_id_fkey foreign KEY (app_id) references mobile_apps (id) on delete cascade,
  constraint mobile_refresh_tokens_user_id_fkey foreign KEY (user_id) references users (id) on delete cascade,
  constraint mobile_refresh_tokens_reason_check check (
    revoke_reason is null
    or revoke_reason in ('rotated', 'family_replay', 'user_logout', 'admin', 'expired')
  )
) tablespace pg_default;

-- Lookup all tokens a given user has on a given app (logout-all, account switcher).
create index if not exists idx_mobile_refresh_tokens_user_app
  on public.mobile_refresh_tokens using btree (user_id, app_id) tablespace pg_default;

-- Family-wide revocation on replay detection.
create index if not exists idx_mobile_refresh_tokens_family
  on public.mobile_refresh_tokens using btree (family_id) tablespace pg_default;

-- Sweep expired rows.
create index if not exists idx_mobile_refresh_tokens_expires_at
  on public.mobile_refresh_tokens using btree (expires_at) tablespace pg_default;
