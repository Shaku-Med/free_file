-- ============================================================
-- DELETE SUDO VERIFICATION v1
-- ============================================================
-- Email-code verification for permanent content deletion ("sudo mode").
-- Separate from the signup/reset `verification` table so a delete code can
-- never clobber an in-flight signup or password-reset code.
--
-- Flow: app emails a 6-digit code (bcrypt hash stored here, 20 min TTL,
-- max 5 attempts) -> on success the app sets a signed HttpOnly session
-- cookie (2h internal expiry) and the row is deleted.
-- Run in Supabase SQL Editor (idempotent).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sudo_verification (
  user_id    uuid PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts   int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sudo_verification ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: server-side only (service_role).

-- Atomic failed-attempt counter (read-then-write from the app would race).
CREATE OR REPLACE FUNCTION public.increment_sudo_verification_attempts(p_user_id uuid)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE sudo_verification
  SET attempts = attempts + 1
  WHERE user_id = p_user_id
  RETURNING attempts;
$$;

REVOKE ALL ON FUNCTION public.increment_sudo_verification_attempts(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_sudo_verification_attempts(uuid) TO service_role;
