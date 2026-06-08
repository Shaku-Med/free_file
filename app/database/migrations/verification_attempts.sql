-- Per-code failed-attempt counter. Hard-caps brute-force of the 6-digit
-- verification / reset code: after N wrong guesses the row is burned and the
-- user must request a new code. Defends the /auth/verify flow against
-- targeted brute-force even if the rate limiter is bypassed.

ALTER TABLE public.verification
  ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;

-- Atomic increment so concurrent guesses can't race past the cap.
CREATE OR REPLACE FUNCTION public.increment_verification_attempts(p_user_id uuid)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.verification
  SET attempts = attempts + 1
  WHERE user_id = p_user_id
  RETURNING attempts;
$$;

REVOKE ALL ON FUNCTION public.increment_verification_attempts(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_verification_attempts(uuid) TO service_role;
