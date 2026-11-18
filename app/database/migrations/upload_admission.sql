-- ============================================================
-- Upload admission. Run AFTER upload_quota.sql and overflow_upload_quota.sql.
-- ============================================================
-- A video is let in when the file itself fits in what the user has left.
-- Processing can make it bigger (every quality is stored), and that charge
-- is capped at the room the user had, so one upload can use up the rest of
-- the monthly budget but never go past it.
--
--   admit_upload            at /complete: reserves the file's size, under a
--                           per user lock so two uploads cannot both squeeze
--                           into the same space.
--   charge_upload           every later size report for an admitted upload.
--                           Never below the file's size, never past the room.
--   release_upload_admission undoes an admission whose upload never got queued.
--
-- floor_bytes is the admitted file size. 0 means the row was not created by
-- admit_upload (side uploads, rows from before this file), which keep the old
-- uncapped behaviour.
-- ============================================================

ALTER TABLE public.upload_quota_ledger
  ADD COLUMN IF NOT EXISTS floor_bytes bigint NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'upload_quota_ledger_floor_bytes_check'
  ) THEN
    ALTER TABLE public.upload_quota_ledger
      ADD CONSTRAINT upload_quota_ledger_floor_bytes_check CHECK (floor_bytes >= 0);
  END IF;
END $$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('admit_upload', 'charge_upload', 'release_upload_admission')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE', r.nspname, r.proname, r.args);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.admit_upload(
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
  v_owner uuid;
  v_used  bigint;
BEGIN
  IF p_user_id IS NULL OR p_upload_id IS NULL OR p_upload_id !~ '^[a-f0-9]{32}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;
  IF p_bytes IS NULL OR p_bytes <= 0 OR p_limit_bytes IS NULL OR p_limit_bytes <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- An admission is confirmed by the queued webhook within seconds. One still
  -- unconfirmed after a day belongs to an upload that never got queued.
  DELETE FROM upload_quota_ledger
  WHERE user_id = p_user_id
    AND status = 'reserved'
    AND floor_bytes > 0
    AND created_at < now() - interval '1 day';

  SELECT user_id INTO v_owner FROM upload_quota_ledger WHERE upload_id = p_upload_id;
  IF FOUND AND v_owner <> p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;

  SELECT coalesce(sum(bytes), 0) INTO v_used
  FROM upload_quota_ledger
  WHERE user_id = p_user_id
    AND scope = 'monthly'
    AND created_at > now() - interval '30 days';

  -- A retried /complete for an upload already admitted.
  IF v_owner IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'used', v_used, 'limit', p_limit_bytes,
      'remaining', greatest(p_limit_bytes - v_used, 0));
  END IF;

  IF v_used + p_bytes > p_limit_bytes THEN
    RETURN jsonb_build_object('ok', false, 'error', 'limit', 'used', v_used, 'limit', p_limit_bytes,
      'remaining', greatest(p_limit_bytes - v_used, 0));
  END IF;

  INSERT INTO upload_quota_ledger (user_id, upload_id, bytes, status, scope, floor_bytes)
  VALUES (p_user_id, p_upload_id, p_bytes, 'reserved', 'monthly', p_bytes);

  RETURN jsonb_build_object('ok', true, 'used', v_used + p_bytes, 'limit', p_limit_bytes,
    'remaining', greatest(p_limit_bytes - v_used - p_bytes, 0));
END;
$$;

CREATE OR REPLACE FUNCTION public.charge_upload(
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
  v_row    upload_quota_ledger%ROWTYPE;
  v_others bigint;
  v_bytes  bigint;
BEGIN
  IF p_user_id IS NULL OR p_upload_id IS NULL OR p_upload_id = '' THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  IF p_limit_bytes IS NULL OR p_limit_bytes <= 0 THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  IF p_bytes IS NULL OR p_bytes < 0 THEN
    p_bytes := 0;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  SELECT * INTO v_row FROM upload_quota_ledger WHERE upload_id = p_upload_id FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO upload_quota_ledger (user_id, upload_id, bytes, status, scope)
    VALUES (p_user_id, p_upload_id, p_bytes, 'committed', 'monthly');
    RETURN jsonb_build_object('ok', true, 'bytes', p_bytes);
  END IF;

  IF v_row.user_id <> p_user_id THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  IF v_row.floor_bytes = 0 THEN
    v_bytes := p_bytes;
  ELSE
    SELECT coalesce(sum(bytes), 0) INTO v_others
    FROM upload_quota_ledger
    WHERE user_id = p_user_id
      AND scope = 'monthly'
      AND created_at > now() - interval '30 days'
      AND upload_id <> p_upload_id;
    v_bytes := greatest(v_row.floor_bytes, least(p_bytes, greatest(p_limit_bytes - v_others, 0)));
  END IF;

  UPDATE upload_quota_ledger
  SET bytes = v_bytes, status = 'committed', updated_at = now()
  WHERE upload_id = p_upload_id;

  RETURN jsonb_build_object('ok', true, 'bytes', v_bytes);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_upload_admission(p_user_id uuid, p_upload_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL OR p_upload_id IS NULL OR p_upload_id !~ '^[a-f0-9]{32}$' THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  DELETE FROM upload_quota_ledger
  WHERE user_id = p_user_id
    AND upload_id = p_upload_id
    AND status = 'reserved'
    AND floor_bytes > 0;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admit_upload(uuid, text, bigint, bigint)  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.charge_upload(uuid, text, bigint, bigint) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_upload_admission(uuid, text)      FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admit_upload(uuid, text, bigint, bigint)  TO service_role;
GRANT EXECUTE ON FUNCTION public.charge_upload(uuid, text, bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_upload_admission(uuid, text)      TO service_role;
