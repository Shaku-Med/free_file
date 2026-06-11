-- ============================================================
-- Overflow upload quota  extra WEEKLY allowance after the
-- monthly limit fills up. Run AFTER upload_quota.sql.
-- ============================================================
-- Ledger rows now carry a scope:
--   'monthly'  : normal uploads, counted in the rolling 30-day window
--   'overflow' : uploads accepted on the extra allowance, counted in a
--                rolling 7-day window (limit comes from env
--                OVERFLOW_WEEKLY_LIMIT_BYTES, default 10 GiB)
-- The storage routing for overflow uploads is decided by GoUpload; this
-- schema only meters the two budgets separately.
-- ============================================================

ALTER TABLE public.upload_quota_ledger
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'monthly';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'upload_quota_ledger_scope_check'
  ) THEN
    ALTER TABLE public.upload_quota_ledger
      ADD CONSTRAINT upload_quota_ledger_scope_check CHECK (scope IN ('monthly', 'overflow'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_upload_quota_ledger_user_scope_time
  ON public.upload_quota_ledger (user_id, scope, created_at DESC);

-- ------------------------------------------------------------
-- record_upload_usage  now scope-aware. Drop ALL old signatures first.
-- ------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('record_upload_usage', 'get_monthly_upload_usage', 'get_overflow_weekly_usage')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE', r.nspname, r.proname, r.args);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.record_upload_usage(
  p_user_id   uuid,
  p_upload_id text,
  p_bytes     bigint,
  p_scope     text DEFAULT 'monthly'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text;
BEGIN
  IF p_user_id IS NULL OR p_upload_id IS NULL OR p_upload_id = '' THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  IF p_bytes IS NULL OR p_bytes < 0 THEN
    p_bytes := 0;
  END IF;
  v_scope := CASE WHEN p_scope = 'overflow' THEN 'overflow' ELSE 'monthly' END;

  INSERT INTO upload_quota_ledger (user_id, upload_id, bytes, status, scope)
  VALUES (p_user_id, p_upload_id, p_bytes, 'committed', v_scope)
  ON CONFLICT (upload_id) DO UPDATE
    SET bytes = excluded.bytes,
        status = 'committed',
        -- Keep the scope the row was first recorded with: a stale retry of
        -- the queued webhook must not flip an overflow row back to monthly.
        scope = CASE WHEN upload_quota_ledger.scope = 'overflow' OR excluded.scope = 'overflow'
                     THEN 'overflow' ELSE 'monthly' END,
        updated_at = now();
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ------------------------------------------------------------
-- get_monthly_upload_usage  now counts ONLY monthly-scope rows so the
-- overflow allowance never eats the user's normal budget.
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
  WHERE user_id = p_user_id
    AND scope = 'monthly'
    AND created_at > now() - interval '30 days';
$$;

-- ------------------------------------------------------------
-- get_overflow_weekly_usage  bytes used from the extra allowance in the
-- rolling 7-day window.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_overflow_weekly_usage(p_user_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(sum(bytes), 0)::bigint
  FROM upload_quota_ledger
  WHERE user_id = p_user_id
    AND scope = 'overflow'
    AND created_at > now() - interval '7 days';
$$;

REVOKE ALL ON FUNCTION public.record_upload_usage(uuid, text, bigint, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_monthly_upload_usage(uuid)               FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_overflow_weekly_usage(uuid)              FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_upload_usage(uuid, text, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_monthly_upload_usage(uuid)                TO service_role;
GRANT EXECUTE ON FUNCTION public.get_overflow_weekly_usage(uuid)               TO service_role;

-- get_weekly_upload_usage (legacy alias) still points at the monthly fn  unchanged.
