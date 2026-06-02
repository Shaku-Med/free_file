-- ============================================================
-- Personal "not recommended" / "don't recommend creator" preferences.
-- Polymorphic via target_type (file | user). Each row = one hide.
-- Aggregate per-creator hide_score drives global feed downrank.
-- ============================================================
create table if not exists public.feed_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  target_type text not null check (target_type in ('file','user')),
  target_id text not null,
  reason text,                                  -- optional "why"; left null for the basic flow
  created_at timestamptz not null default now(),
  expires_at timestamptz,                       -- null = forever; set for "snooze 30 days" later
  constraint feed_pref_one_per_user_target unique (user_id, target_type, target_id)
);

create index if not exists idx_feed_pref_user
  on public.feed_preferences (user_id, target_type);
create index if not exists idx_feed_pref_target
  on public.feed_preferences (target_type, target_id);
create index if not exists idx_feed_pref_active
  on public.feed_preferences (user_id, target_type, expires_at);

-- Creator-level signal. Bumped when a unique user hides the creator OR any of
-- their files. Used by the feed RPC as a downrank multiplier.
alter table public.users
  add column if not exists hide_score int not null default 0;

alter table public.feed_preferences enable row level security;

-- Drop old signatures cleanly.
DO $$
DECLARE r RECORD;
  fns text[] := ARRAY['set_feed_preference','clear_feed_preference','list_feed_preferences'];
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
-- set_feed_preference  hide a file OR a creator from this user's feed.
-- Idempotent. When the target is a creator (and it's a NEW hide), bumps
-- users.hide_score so the global feed dials them down. When the target is
-- a file owned by someone, also bumps the owner's hide_score (treating
-- "not interested in this clip" as a soft creator signal too).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_feed_preference(
  p_user_id     uuid,
  p_target_type text,
  p_target_id   text,
  p_reason      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_inserted boolean := false;
BEGIN
  IF p_user_id IS NULL OR p_target_id IS NULL OR p_target_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;
  IF p_target_type NOT IN ('file','user') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_target_type');
  END IF;

  -- Don't let people hide themselves; harmless but pointless.
  IF p_target_type = 'user' AND p_target_id::uuid = p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'self_target');
  END IF;

  INSERT INTO feed_preferences (user_id, target_type, target_id, reason)
  VALUES (p_user_id, p_target_type, p_target_id, p_reason)
  ON CONFLICT (user_id, target_type, target_id) DO NOTHING
  RETURNING true INTO v_inserted;

  IF NOT v_inserted THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;

  -- Creator-level aggregation. Each unique hider counts once per creator.
  IF p_target_type = 'user' THEN
    UPDATE users SET hide_score = hide_score + 1 WHERE id = p_target_id::uuid;
  ELSIF p_target_type = 'file' THEN
    SELECT owner_id INTO v_owner FROM files WHERE unique_id = p_target_id;
    -- Only count if this user hasn't already hidden the creator (avoid double-counting).
    IF v_owner IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM feed_preferences
      WHERE user_id = p_user_id AND target_type = 'user' AND target_id = v_owner::text
    ) THEN
      UPDATE users SET hide_score = hide_score + 1 WHERE id = v_owner;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ------------------------------------------------------------
-- clear_feed_preference  undo a personal hide. Drops the row + decrements
-- the creator's hide_score symmetrically.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clear_feed_preference(
  p_user_id     uuid,
  p_target_type text,
  p_target_id   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_deleted int;
BEGIN
  IF p_user_id IS NULL OR p_target_id IS NULL OR p_target_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;
  IF p_target_type NOT IN ('file','user') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_target_type');
  END IF;

  DELETE FROM feed_preferences
   WHERE user_id = p_user_id AND target_type = p_target_type AND target_id = p_target_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 THEN
    RETURN jsonb_build_object('ok', true, 'noop', true);
  END IF;

  IF p_target_type = 'user' THEN
    UPDATE users SET hide_score = greatest(hide_score - 1, 0) WHERE id = p_target_id::uuid;
  ELSIF p_target_type = 'file' THEN
    SELECT owner_id INTO v_owner FROM files WHERE unique_id = p_target_id;
    IF v_owner IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM feed_preferences
      WHERE user_id = p_user_id AND target_type = 'user' AND target_id = v_owner::text
    ) THEN
      UPDATE users SET hide_score = greatest(hide_score - 1, 0) WHERE id = v_owner;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ------------------------------------------------------------
-- list_feed_preferences  paged list for the user's "hidden" management UI.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_feed_preferences(
  p_user_id     uuid,
  p_target_type text DEFAULT NULL,
  p_limit       int  DEFAULT 50,
  p_offset      int  DEFAULT 0
)
RETURNS TABLE (
  target_type text,
  target_id   text,
  reason      text,
  created_at  timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT fp.target_type, fp.target_id, fp.reason, fp.created_at
  FROM feed_preferences fp
  WHERE fp.user_id = p_user_id
    AND (p_target_type IS NULL OR fp.target_type = p_target_type)
    AND (fp.expires_at IS NULL OR fp.expires_at > now())
  ORDER BY fp.created_at DESC
  LIMIT GREATEST(LEAST(p_limit, 200), 1)
  OFFSET GREATEST(p_offset, 0);
$$;

REVOKE ALL ON FUNCTION public.set_feed_preference(uuid,text,text,text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_feed_preference(uuid,text,text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_feed_preferences(uuid,text,int,int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_feed_preference(uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_feed_preference(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_feed_preferences(uuid,text,int,int) TO service_role;
