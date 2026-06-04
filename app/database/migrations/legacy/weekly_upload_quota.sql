-- ============================================================
-- Weekly upload quota (rolling 7-day window, reservation ledger)
-- ============================================================
-- Flow: app reserves bytes BEFORE queueing an upload, finalizes with the
-- real byte count on completion, refunds on cancel/failure. The byte limit
-- is passed in by the caller (env WEEKLY_UPLOAD_LIMIT_BYTES) so it is never
-- hardcoded here.
--
-- SECURITY: ledger is RLS-locked with no policies, and every function is
-- SECURITY DEFINER restricted to service_role. A client must NOT be able to
-- call refund/reserve directly (that would let a user wipe their own usage
-- or mint reservations). All access goes through trusted server routes.
-- ============================================================

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

-- Drop old signatures so re-runs stay clean.
DO $$
DECLARE
  r RECORD;
  fns text[] := ARRAY[
    'reserve_upload_quota',
    'finalize_upload_quota',
    'refund_upload_quota',
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

  -- Serialize per user: 200 concurrent reservations must not each read a
  -- stale total and collectively exceed the limit. Lock is held to tx end.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- Idempotent: same upload_id reserved twice returns current state, no double count.
  IF EXISTS (SELECT 1 FROM upload_quota_ledger WHERE upload_id = p_upload_id) THEN
    SELECT coalesce(sum(bytes), 0) INTO v_used
    FROM upload_quota_ledger
    WHERE user_id = p_user_id AND created_at > now() - interval '7 days';
    RETURN jsonb_build_object('ok', true, 'used', v_used, 'limit', p_limit_bytes,
      'remaining', greatest(p_limit_bytes - v_used, 0), 'already', true);
  END IF;

  SELECT coalesce(sum(bytes), 0) INTO v_used
  FROM upload_quota_ledger
  WHERE user_id = p_user_id AND created_at > now() - interval '7 days';

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
-- get_weekly_upload_usage  bytes used in the rolling 7-day window.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_weekly_upload_usage(p_user_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(sum(bytes), 0)::bigint
  FROM upload_quota_ledger
  WHERE user_id = p_user_id AND created_at > now() - interval '7 days';
$$;

-- ------------------------------------------------------------
-- Grants: server-only. Never expose to anon/authenticated.
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.reserve_upload_quota(uuid, text, bigint, bigint) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_upload_quota(text, bigint) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_upload_quota(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_weekly_upload_usage(uuid) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserve_upload_quota(uuid, text, bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_upload_quota(text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_upload_quota(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_weekly_upload_usage(uuid) TO service_role;
