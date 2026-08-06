-- Where in playback a viewer acted.
--
-- A subscribe at 90% of a video is a far stronger endorsement than one at 5%,
-- and a dislike at 5% says something different from a dislike at 80%. Storing
-- the position alongside the action lets ranking tell those apart.
--
-- One row per (user, file, action). That primary key is the anti-inflation
-- mechanism: replaying the same action a thousand times updates one row instead
-- of adding a thousand signals.

CREATE TABLE IF NOT EXISTS public.file_action_positions (
  user_id          uuid NOT NULL,
  file_id          uuid NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  action           text NOT NULL CHECK (action IN ('like', 'dislike', 'save', 'subscribe')),
  position_seconds numeric(12,3) NOT NULL DEFAULT 0,
  -- NULL when the file has no known duration; never read from the client.
  position_ratio   real,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, file_id, action)
);

CREATE INDEX IF NOT EXISTS file_action_positions_file_action_idx
  ON public.file_action_positions (file_id, action);

-- No policies on purpose. Every read and write goes through the SECURITY
-- DEFINER functions below, so the anon key can never touch this table directly
-- and per-user viewing positions stay server side.
ALTER TABLE public.file_action_positions ENABLE ROW LEVEL SECURITY;

-- p_position is client-supplied and therefore untrusted. It is clamped into the
-- file's real runtime and the ratio is derived here, so a forged payload cannot
-- claim a deep view on a video the sender never watched.
-- p_require_owner: when set, the file must belong to that owner or nothing is
-- recorded. Subscribe is a channel-level action carrying the file that prompted
-- it, and without this check a client could attribute its subscribe to any file
-- id it liked and inflate that file's signal.
CREATE OR REPLACE FUNCTION public.record_action_position(
  p_user_id       uuid,
  p_file_id       uuid,
  p_action        text,
  p_position      numeric,
  p_active        boolean DEFAULT true,
  p_require_owner uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_duration numeric;
  v_owner    uuid;
  v_pos      numeric;
  v_ratio    real;
BEGIN
  IF p_user_id IS NULL OR p_file_id IS NULL THEN
    RETURN;
  END IF;
  IF p_action NOT IN ('like', 'dislike', 'save', 'subscribe') THEN
    RETURN;
  END IF;

  -- Action undone (unlike, unsave, unsubscribe): drop the signal with it.
  IF p_active IS NOT TRUE THEN
    DELETE FROM file_action_positions
    WHERE user_id = p_user_id AND file_id = p_file_id AND action = p_action;
    RETURN;
  END IF;

  SELECT NULLIF(duration, 0), owner_id INTO v_duration, v_owner
  FROM files WHERE id = p_file_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF p_require_owner IS NOT NULL AND v_owner IS DISTINCT FROM p_require_owner THEN
    RETURN;
  END IF;

  v_pos := GREATEST(COALESCE(p_position, 0), 0);
  IF v_duration IS NOT NULL THEN
    v_pos   := LEAST(v_pos, v_duration);
    v_ratio := (v_pos / v_duration)::real;
  END IF;

  INSERT INTO file_action_positions (user_id, file_id, action, position_seconds, position_ratio)
  VALUES (p_user_id, p_file_id, p_action, v_pos, v_ratio)
  ON CONFLICT (user_id, file_id, action) DO UPDATE
    SET position_seconds = EXCLUDED.position_seconds,
        position_ratio   = EXCLUDED.position_ratio,
        updated_at       = now();
END;
$$;

REVOKE ALL ON FUNCTION public.record_action_position(uuid, uuid, text, numeric, boolean, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.record_action_position(uuid, uuid, text, numeric, boolean, uuid) TO anon, authenticated;
