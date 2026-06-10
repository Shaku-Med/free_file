-- ============================================================
-- LIVE WATCH PROFILE  build the user's interest profile AS THEY WATCH
-- ============================================================
-- Replaces record_watch_time (same signature) so every accepted watch
-- event also incrementally bumps:
--   1. user_interest_scores   per-category interest (drives get_feed v6)
--   2. user_creator_affinity  per-creator affinity
-- Until now those tables only updated on the 4h batch recompute
-- (refresh_user_personalization), so a brand-new viewer scrolled a cold
-- feed for hours. With this, the very next feed page already reflects
-- what they just watched.
--
-- Weights mirror recompute_user_interests / recompute_creator_affinity
-- (watch weight = LEAST(watch_percentage * 5, 5)), so the periodic batch
-- recompute stays the source of truth and simply squashes these
-- increments  no drift, no double counting.
--
-- Run in Supabase SQL Editor AFTER personalization_tables.sql.
-- ============================================================

CREATE OR REPLACE FUNCTION record_watch_time(
  p_user_id uuid,
  p_file_id uuid,
  p_watch_duration_s real,
  p_total_duration_s real
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pct real;
  v_old_pct real;
  v_watch real;
  v_total real;
  v_weight_delta real;
BEGIN
  IF p_user_id IS NULL OR p_file_id IS NULL THEN
    RETURN false;
  END IF;

  -- Clamp to 24h per event (matches API guardrails; prevents absurd stored values)
  v_watch := LEAST(86400.0::real, GREATEST(0.0::real, COALESCE(p_watch_duration_s, 0)));
  v_total := LEAST(86400.0::real, GREATEST(0.0::real, COALESCE(p_total_duration_s, 0)));

  -- Dedupe window: one row per user/file per 5 min. Grab the old percentage
  -- so the live profile only gets the DELTA, never a double count.
  SELECT fwt.watch_percentage INTO v_old_pct
  FROM file_watch_time fwt
  WHERE fwt.user_id = p_user_id
    AND fwt.file_id = p_file_id
    AND fwt.created_at > now() - interval '5 minutes'
  ORDER BY fwt.created_at DESC
  LIMIT 1;

  IF v_old_pct IS NOT NULL THEN
    UPDATE file_watch_time
    SET
      watch_duration_s = GREATEST(file_watch_time.watch_duration_s, v_watch),
      total_duration_s = CASE
        WHEN v_total > 0 THEN v_total
        ELSE file_watch_time.total_duration_s
      END,
      watch_percentage = CASE
        WHEN v_total > 0
        THEN LEAST(1.0, GREATEST(file_watch_time.watch_duration_s, v_watch) / v_total)
        WHEN file_watch_time.total_duration_s > 0
        THEN LEAST(1.0, GREATEST(file_watch_time.watch_duration_s, v_watch) / file_watch_time.total_duration_s)
        ELSE 0
      END
    WHERE user_id = p_user_id
      AND file_id = p_file_id
      AND created_at > now() - interval '5 minutes';

    -- Re-read the updated pct to compute the live-profile delta
    SELECT fwt.watch_percentage INTO v_pct
    FROM file_watch_time fwt
    WHERE fwt.user_id = p_user_id
      AND fwt.file_id = p_file_id
      AND fwt.created_at > now() - interval '5 minutes'
    ORDER BY fwt.created_at DESC
    LIMIT 1;

    v_weight_delta := GREATEST(0.0,
      LEAST(COALESCE(v_pct, 0) * 5.0, 5.0) - LEAST(COALESCE(v_old_pct, 0) * 5.0, 5.0));
  ELSE
    v_pct := CASE
      WHEN v_total > 0 THEN LEAST(1.0, v_watch / v_total)
      ELSE 0
    END;

    INSERT INTO file_watch_time (user_id, file_id, watch_duration_s, total_duration_s, watch_percentage)
    VALUES (p_user_id, p_file_id, v_watch, v_total, v_pct);

    v_weight_delta := LEAST(v_pct * 5.0, 5.0);
  END IF;

  -- ── Live profile update ──
  -- Skip negligible watches (< ~3% of the video) so a fast scroll past a
  -- card doesn't pollute the profile.
  IF v_weight_delta >= 0.15 THEN
    -- Per-category interest from the watched file's categories
    INSERT INTO user_interest_scores (user_id, category, score, interaction_count, last_updated)
    SELECT p_user_id, cat.value, v_weight_delta, 1, now()
    FROM files f
    CROSS JOIN LATERAL jsonb_array_elements_text(f.categories) AS cat(value)
    WHERE f.id = p_file_id
      AND f.categories IS NOT NULL
      AND jsonb_typeof(f.categories) = 'array'
    ON CONFLICT (user_id, category) DO UPDATE
    SET score = user_interest_scores.score + EXCLUDED.score,
        interaction_count = user_interest_scores.interaction_count + 1,
        last_updated = now();

    -- Creator affinity (never toward yourself, matches batch recompute)
    INSERT INTO user_creator_affinity (user_id, creator_id, affinity_score, interaction_count, last_interaction)
    SELECT p_user_id, f.owner_id, v_weight_delta, 1, now()
    FROM files f
    WHERE f.id = p_file_id
      AND f.owner_id IS NOT NULL
      AND f.owner_id != p_user_id
    ON CONFLICT (user_id, creator_id) DO UPDATE
    SET affinity_score = user_creator_affinity.affinity_score + EXCLUDED.affinity_score,
        interaction_count = user_creator_affinity.interaction_count + 1,
        last_interaction = now();
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION record_watch_time(uuid, uuid, real, real) TO authenticated;
