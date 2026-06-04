-- ============================================================
-- Monthly upload quota (rolling 30-day window, reservation ledger)
-- ============================================================
-- SUPERSEDES weekly_upload_quota.sql.  Same table + same access model;
-- only the WINDOW changes (7 days → 30 days) and the helper function
-- gets a clearer name (`get_monthly_upload_usage`).
--
-- Run order: this file is safe to re-run; everything is CREATE OR REPLACE
-- and the time window is the only material change. The legacy
-- `get_weekly_upload_usage` helper is kept as a thin alias so any
-- still-deploying server build that calls the old name keeps working
-- through the rollover  remove it once both app + GoUpload are on
-- this version.
--
-- SECURITY: unchanged from the weekly version  ledger is RLS-locked
-- with no policies, every function is SECURITY DEFINER restricted to
-- service_role. Clients must never call refund/reserve directly.
-- ============================================================

-- Drop the *parameter signatures* we are about to redeclare so re-runs
-- don't fail on "function already exists with different return".
DO $$
DECLARE
  r RECORD;
  fns text[] := ARRAY[
    'reserve_upload_quota',
    'get_monthly_upload_usage',
    'get_weekly_upload_usage'
  ];
  fn text;
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    FOR r IN
      SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn
    LOOP
      EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE', r.nspname, r.proname, r.args);
    END LOOP;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- reserve_upload_quota  atomically reserve bytes for one upload.
-- IDENTICAL to the weekly version except the rolling window is 30 days.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_upload_quota(
  p_user_id     uuid,
  p_upload_id   text,
  p_bytes       bigint,
  p_limit_bytes bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used bigint;
BEGIN
  IF p_user_id IS NULL OR p_upload_id IS NULL OR p_upload_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;
  IF p_bytes IS NULL OR p_bytes < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;
  IF p_limit_bytes IS NULL OR p_limit_bytes <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;

  -- Serialize per user: many concurrent reservations must not each read a
  -- stale total and collectively exceed the limit. Lock is held to tx end.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- Idempotent: same upload_id reserved twice returns current state, no double count.
  IF EXISTS (SELECT 1 FROM upload_quota_ledger WHERE upload_id = p_upload_id) THEN
    SELECT coalesce(sum(bytes), 0) INTO v_used
    FROM upload_quota_ledger
    WHERE user_id = p_user_id AND created_at > now() - interval '30 days';
    RETURN jsonb_build_object('ok', true, 'used', v_used, 'limit', p_limit_bytes,
      'remaining', greatest(p_limit_bytes - v_used, 0), 'already', true);
  END IF;

  SELECT coalesce(sum(bytes), 0) INTO v_used
  FROM upload_quota_ledger
  WHERE user_id = p_user_id AND created_at > now() - interval '30 days';

  IF v_used + p_bytes > p_limit_bytes THEN
    RETURN jsonb_build_object('ok', false, 'error', 'limit', 'used', v_used,
      'limit', p_limit_bytes, 'remaining', greatest(p_limit_bytes - v_used, 0));
  END IF;

  INSERT INTO upload_quota_ledger (user_id, upload_id, bytes, status)
  VALUES (p_user_id, p_upload_id, p_bytes, 'reserved');

  RETURN jsonb_build_object('ok', true, 'used', v_used + p_bytes, 'limit', p_limit_bytes,
    'remaining', greatest(p_limit_bytes - (v_used + p_bytes), 0));
END;
$$;

-- ------------------------------------------------------------
-- get_monthly_upload_usage  bytes used in the rolling 30-day window.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_monthly_upload_usage(p_user_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(sum(bytes), 0)::bigint
  FROM upload_quota_ledger
  WHERE user_id = p_user_id AND created_at > now() - interval '30 days';
$$;

-- ------------------------------------------------------------
-- Backward-compat alias  delete once every server uses the monthly name.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_weekly_upload_usage(p_user_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_monthly_upload_usage(p_user_id);
$$;

-- ------------------------------------------------------------
-- Grants: server-only. Never expose to anon/authenticated.
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.reserve_upload_quota(uuid, text, bigint, bigint) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_monthly_upload_usage(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_weekly_upload_usage(uuid) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserve_upload_quota(uuid, text, bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_monthly_upload_usage(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_weekly_upload_usage(uuid) TO service_role;
