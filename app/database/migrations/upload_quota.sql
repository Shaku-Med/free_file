-- ============================================================
-- Upload quota  CURRENT canonical schema (rolling 30-day window)
-- ============================================================
-- Single source of truth for the per-user upload quota subsystem.
-- Supersedes:
--   - weekly_upload_quota.sql        (table + reserve / finalize / refund / weekly-usage)
--   - weekly_upload_quota_record.sql (record_upload_usage)
--   - monthly_upload_quota.sql       (window 7d -> 30d + monthly-usage alias)
-- Those three live under migrations/legacy/ for historical reference; run THIS
-- file on a fresh database and you have the full current state.
--
-- Flow (mirrors what the app + GoUpload server do):
--   1. App reserves bytes BEFORE queueing an upload.
--   2. Finalizes with the real byte count on completion (or webhook).
--   3. Refunds on cancel / failure.
--   4. The byte limit is passed in by the caller (env MONTHLY_UPLOAD_LIMIT_BYTES
--      or legacy WEEKLY_UPLOAD_LIMIT_BYTES) so it is never hardcoded here.
--
-- SECURITY:
--   - upload_quota_ledger is RLS-locked with NO policies.
--   - Every function is SECURITY DEFINER, restricted to service_role.
--   - A client must NEVER be able to call refund / reserve directly (that would
--     let a user wipe their own usage or mint reservations). All access goes
--     through trusted server-side routes (the app + the Go upload webhook).
-- ============================================================

-- ------------------------------------------------------------
-- Ledger table  one row per reserved/committed upload.
-- ------------------------------------------------------------
create table if not exists public.upload_quota_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  upload_id text not null,
  bytes bigint not null check (bytes >= 0),
  status text not null default 'reserved' check (status in ('reserved', 'committed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint upload_quota_ledger_upload_id_key unique (upload_id)
);

create index if not exists idx_upload_quota_ledger_user_time
  on public.upload_quota_ledger (user_id, created_at desc);

alter table public.upload_quota_ledger enable row level security;
-- Intentionally no policies: only SECURITY DEFINER functions / service_role touch this table.

-- ------------------------------------------------------------
-- Drop existing signatures so re-runs stay clean. Covers every variant
-- this subsystem has ever shipped, so a fresh apply on top of an old DB
-- doesn't fail on "function already exists with different return type".
-- ------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  fns text[] := ARRAY[
    'reserve_upload_quota',
    'finalize_upload_quota',
    'refund_upload_quota',
    'record_upload_usage',
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
-- Returns { ok, used, limit, remaining, error?, already? }.
-- Window: rolling 30 days.
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

  -- Serialize per user: concurrent reservations must not each read a stale
  -- total and collectively exceed the cap. Lock is held to tx end.
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
-- finalize_upload_quota  reconcile the reservation with the real size.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_upload_quota(
  p_upload_id    text,
  p_actual_bytes bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_upload_id IS NULL OR p_upload_id = '' THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  UPDATE upload_quota_ledger
  SET bytes = CASE WHEN p_actual_bytes IS NOT NULL AND p_actual_bytes >= 0
                   THEN p_actual_bytes ELSE bytes END,
      status = 'committed',
      updated_at = now()
  WHERE upload_id = p_upload_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ------------------------------------------------------------
-- refund_upload_quota  release a reservation (cancel / failed upload).
-- Idempotent  safe to call against a missing or already-deleted row.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_upload_quota(p_upload_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_upload_id IS NULL OR p_upload_id = '' THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  DELETE FROM upload_quota_ledger WHERE upload_id = p_upload_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ------------------------------------------------------------
-- record_upload_usage  unconditionally upsert an upload's byte cost.
-- Used by the upload webhook so uploads that go straight to the Go server
-- (bypassing the app's reserve step) still count against the cap. Idempotent
-- by upload_id; no limit gate (it records what already happened).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_upload_usage(
  p_user_id   uuid,
  p_upload_id text,
  p_bytes     bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL OR p_upload_id IS NULL OR p_upload_id = '' THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  IF p_bytes IS NULL OR p_bytes < 0 THEN
    p_bytes := 0;
  END IF;
  INSERT INTO upload_quota_ledger (user_id, upload_id, bytes, status)
  VALUES (p_user_id, p_upload_id, p_bytes, 'committed')
  ON CONFLICT (upload_id) DO UPDATE
    SET bytes = excluded.bytes,
        status = 'committed',
        updated_at = now();
  RETURN jsonb_build_object('ok', true);
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
-- get_weekly_upload_usage  legacy alias kept so any in-flight server build
-- that calls the old name keeps working. Delete once both app + GoUpload
-- use the monthly name everywhere (currently both do, as of this file).
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
REVOKE ALL ON FUNCTION public.finalize_upload_quota(text, bigint)              FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_upload_quota(text)                        FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_upload_usage(uuid, text, bigint)          FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_monthly_upload_usage(uuid)                   FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_weekly_upload_usage(uuid)                    FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserve_upload_quota(uuid, text, bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_upload_quota(text, bigint)              TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_upload_quota(text)                        TO service_role;
GRANT EXECUTE ON FUNCTION public.record_upload_usage(uuid, text, bigint)          TO service_role;
GRANT EXECUTE ON FUNCTION public.get_monthly_upload_usage(uuid)                   TO service_role;
GRANT EXECUTE ON FUNCTION public.get_weekly_upload_usage(uuid)                    TO service_role;
