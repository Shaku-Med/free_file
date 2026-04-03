-- Passkeys (WebAuthn) credentials and short-lived challenges for registration / authentication.

create table if not exists public.user_passkeys (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  credential_id text not null,
  public_key text not null,
  counter bigint not null default 0,
  transports text[] null,
  device_name text null,
  created_at timestamptz not null default now(),
  constraint user_passkeys_credential_id_key unique (credential_id)
);

create index if not exists idx_user_passkeys_user_id on public.user_passkeys (user_id);

create table if not exists public.webauthn_challenges (
  id text not null primary key,
  challenge text not null,
  user_id uuid null references public.users (id) on delete cascade,
  kind text not null,
  expires_at timestamptz not null,
  constraint webauthn_challenges_kind_check check (kind in ('registration', 'authentication'))
);

create index if not exists idx_webauthn_challenges_expires_at on public.webauthn_challenges (expires_at);
