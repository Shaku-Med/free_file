-- Feature flags: turn something off without a deploy.
--
-- Both code paths ship in the bundle; this table decides which one runs. The
-- point is that killing a feature is a row update rather than an emergency
-- push through a runner that might be offline.
--
-- Reads go through get_feature_flags(), which returns ONLY what a client is
-- allowed to know. The table itself stays server side: audience rules and the
-- rollout percentage are not the browser's business, and exposing them would
-- tell anyone which unreleased features exist and how to look enrolled.

CREATE TABLE IF NOT EXISTS public.feature_flags (
  key             text PRIMARY KEY CHECK (key ~ '^[a-z0-9_]{2,64}$'),
  description     text,
  -- Master switch. Off means off for everyone, whatever the percentage says.
  enabled         boolean NOT NULL DEFAULT false,
  -- 0..100. Ignored when enabled is false.
  rollout_percent smallint NOT NULL DEFAULT 0
                  CHECK (rollout_percent >= 0 AND rollout_percent <= 100),
  -- 'everyone' | 'signed_in' | 'staff'. Narrower than the percentage, applied first.
  audience        text NOT NULL DEFAULT 'everyone'
                  CHECK (audience IN ('everyone', 'signed_in', 'staff')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.touch_feature_flag()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS feature_flags_touch ON public.feature_flags;
CREATE TRIGGER feature_flags_touch
  BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.touch_feature_flag();

/**
 * Resolved flags for one viewer: { "flag_key": true, ... }.
 *
 * Bucketing is hashtext(key || ':' || viewer) rather than random, so a viewer
 * lands in the same bucket on every request. Without that the feature would
 * flicker on and off between page loads, which is worse than never shipping it.
 *
 * Signed-out viewers get only 'everyone' flags at full rollout. There is no
 * stable identity to bucket them by, and bucketing on something like an IP
 * would move people between variants as their address changes.
 */
CREATE OR REPLACE FUNCTION public.get_feature_flags(
  p_user_id uuid DEFAULT NULL,
  p_is_staff boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_object_agg(f.key, true) FILTER (WHERE
      f.enabled
      AND (
        f.audience = 'everyone'
        OR (f.audience = 'signed_in' AND p_user_id IS NOT NULL)
        OR (f.audience = 'staff' AND p_is_staff)
      )
      AND (
        f.rollout_percent >= 100
        OR (
          p_user_id IS NOT NULL
          AND f.rollout_percent > 0
          -- abs() because hashtext can return negative; mod 100 keeps it in range.
          AND (abs(hashtext(f.key || ':' || p_user_id::text)) % 100) < f.rollout_percent
        )
      )
    ),
    '{}'::jsonb
  )
  FROM feature_flags f;
$$;

REVOKE ALL ON FUNCTION public.get_feature_flags(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.get_feature_flags(uuid, boolean) TO anon, authenticated;
