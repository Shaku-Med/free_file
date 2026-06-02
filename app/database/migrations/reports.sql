-- ============================================================
-- Report system: files, comments, users. Polymorphic via target_type.
-- ============================================================
-- Per-row report. unique on (reporter, target_*) blocks dup reports + lets
-- the API show "already reported" without a separate read. Status drives the
-- mod queue; auto-actions live in submit_report.
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null,
  target_type text not null check (target_type in ('file','comment','user')),
  target_id text not null,
  reason text not null check (reason in (
    'spam','nsfw_unmarked','harassment','hate','violence',
    'self_harm','child_safety','copyright','impersonation','scam','other'
  )),
  details text,
  status text not null default 'open' check (status in ('open','dismissed','actioned')),
  created_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  constraint reports_one_per_user_target unique (reporter_id, target_type, target_id)
);

-- Aggregates on files so feed RPCs read counters in O(1) instead of a join.
alter table public.files
  add column if not exists report_count int not null default 0,
  add column if not exists report_status text not null default 'ok'
    check (report_status in ('ok','flagged','hidden'));

-- Lightweight tracking for false-report weighting (admin uses this to dial
-- down a chronic mis-reporter). Increment when a mod dismisses one of theirs.
alter table public.users
  add column if not exists false_report_count int not null default 0;

create index if not exists idx_reports_reporter
  on public.reports (reporter_id, target_type, created_at desc);
create index if not exists idx_reports_target
  on public.reports (target_type, target_id);
create index if not exists idx_reports_open
  on public.reports (status, created_at desc) where status = 'open';

-- RLS-lock the table; everything goes through SECURITY DEFINER RPCs.
alter table public.reports enable row level security;

-- Drop old signatures for clean re-runs.
DO $$
DECLARE
  r RECORD;
  fns text[] := ARRAY['submit_report','get_report_status'];
  fn text;
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    FOR r IN SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname=fn
    LOOP EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE', r.nspname, r.proname, r.args); END LOOP;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- submit_report  insert + auto-action ladder.
-- Returns: { ok, already?, error? }
-- Auto-actions:
--   child_safety / copyright  hide + unpublish immediately (1 report)
--   nsfw_unmarked              force is_adult=true at 3 unique reporters
--   any reason                 flag at 10 unique reporters
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_report(
  p_reporter_id uuid,
  p_target_type text,
  p_target_id   text,
  p_reason      text,
  p_details     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_owner uuid;
  v_recent int;
  v_unique int;
BEGIN
  IF p_reporter_id IS NULL OR p_target_id IS NULL OR p_target_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;
  IF p_target_type NOT IN ('file','comment','user') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_target_type');
  END IF;
  IF p_reason NOT IN ('spam','nsfw_unmarked','harassment','hate','violence',
    'self_harm','child_safety','copyright','impersonation','scam','other') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_reason');
  END IF;

  -- Cap free-text details. Strip empty.
  IF p_details IS NOT NULL THEN
    p_details := substring(trim(p_details) FROM 1 FOR 500);
    IF p_details = '' THEN p_details := NULL; END IF;
  END IF;

  -- Self-report guards.
  IF p_target_type = 'file' THEN
    SELECT owner_id INTO v_owner FROM files WHERE unique_id = p_target_id;
    IF v_owner IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
    IF v_owner = p_reporter_id THEN RETURN jsonb_build_object('ok', false, 'error', 'self_report'); END IF;
  ELSIF p_target_type = 'comment' THEN
    DECLARE v_cu uuid;
    BEGIN
      SELECT user_id INTO v_cu FROM comments WHERE id = p_target_id::uuid;
      IF v_cu IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
      IF v_cu = p_reporter_id THEN RETURN jsonb_build_object('ok', false, 'error', 'self_report'); END IF;
    END;
  ELSIF p_target_type = 'user' AND p_target_id::uuid = p_reporter_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'self_report');
  END IF;

  -- Rate limit: 30 reports per 24h per reporter.
  SELECT count(*) INTO v_recent FROM reports
    WHERE reporter_id = p_reporter_id AND created_at > v_now - INTERVAL '24 hours';
  IF v_recent >= 30 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  INSERT INTO reports (reporter_id, target_type, target_id, reason, details)
  VALUES (p_reporter_id, p_target_type, p_target_id, p_reason, p_details)
  ON CONFLICT (reporter_id, target_type, target_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;

  -- File-target aggregates + auto-action ladder.
  IF p_target_type = 'file' THEN
    UPDATE files SET report_count = report_count + 1 WHERE unique_id = p_target_id;

    IF p_reason IN ('child_safety','copyright') THEN
      UPDATE files SET report_status = 'hidden', is_public = false
        WHERE unique_id = p_target_id AND report_status <> 'hidden';
    END IF;

    IF p_reason = 'nsfw_unmarked' THEN
      SELECT count(DISTINCT reporter_id) INTO v_unique FROM reports
        WHERE target_type = 'file' AND target_id = p_target_id AND reason = 'nsfw_unmarked';
      IF v_unique >= 3 THEN
        UPDATE files SET is_adult = true WHERE unique_id = p_target_id AND is_adult = false;
      END IF;
    END IF;

    SELECT count(DISTINCT reporter_id) INTO v_unique FROM reports
      WHERE target_type = 'file' AND target_id = p_target_id;
    IF v_unique >= 10 THEN
      UPDATE files SET report_status = 'flagged'
        WHERE unique_id = p_target_id AND report_status = 'ok';
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ------------------------------------------------------------
-- get_report_status  has this user already reported this target?
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_report_status(
  p_reporter_id uuid,
  p_target_type text,
  p_target_id   text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('reported', EXISTS (
    SELECT 1 FROM reports
    WHERE reporter_id = p_reporter_id
      AND target_type = p_target_type
      AND target_id = p_target_id
  ));
$$;

REVOKE ALL ON FUNCTION public.submit_report(uuid,text,text,text,text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_report_status(uuid,text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_report(uuid,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_report_status(uuid,text,text) TO service_role;
