-- ============================================================
-- PERSONALIZATION TABLES  Instagram-grade feed signals
-- ============================================================
-- Run in Supabase SQL Editor. Creates tables for:
--   1. Watch time events (strongest signal)
--   2. Saved/bookmarked files
--   3. User interest profiles (per-category scores)
--   4. Creator affinity (per-creator scores)
--   5. Negative signals (not interested / hide creator)
-- ============================================================


-- ============================================================
-- 1. WATCH TIME EVENTS
-- Tracks how long a user actually watches each file.
-- This is the #1 signal Instagram uses for personalization.
-- ============================================================
CREATE TABLE IF NOT EXISTS file_watch_time (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES files (id) ON DELETE CASCADE,
  watch_duration_s real NOT NULL DEFAULT 0,
  total_duration_s real NOT NULL DEFAULT 0,
  watch_percentage real NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_file_watch_time_user_file
  ON file_watch_time (user_id, file_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_file_watch_time_user_created
  ON file_watch_time (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_file_watch_time_file
  ON file_watch_time (file_id);

ALTER TABLE file_watch_time ENABLE ROW LEVEL SECURITY;

-- RPC to record watch time. Deduplicates: only 1 event per user per file per 5 min.
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
  v_recent_exists boolean;
  v_watch real;
  v_total real;
BEGIN
  IF p_user_id IS NULL OR p_file_id IS NULL THEN
    RETURN false;
  END IF;

  -- Clamp to 24h per event (matches API guardrails; prevents absurd stored values)
  v_watch := LEAST(86400.0::real, GREATEST(0.0::real, COALESCE(p_watch_duration_s, 0)));
  v_total := LEAST(86400.0::real, GREATEST(0.0::real, COALESCE(p_total_duration_s, 0)));

  -- Dedupe: skip if we recorded a watch event for this pair in last 5 min
  SELECT EXISTS (
    SELECT 1 FROM file_watch_time
    WHERE user_id = p_user_id
      AND file_id = p_file_id
      AND created_at > now() - interval '5 minutes'
  ) INTO v_recent_exists;

  IF v_recent_exists THEN
    -- Update the most recent record if the new duration is longer
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
    RETURN true;
  END IF;

  -- Compute watch percentage
  v_pct := CASE
    WHEN v_total > 0
    THEN LEAST(1.0, v_watch / v_total)
    ELSE 0
  END;

  INSERT INTO file_watch_time (user_id, file_id, watch_duration_s, total_duration_s, watch_percentage)
  VALUES (p_user_id, p_file_id, v_watch, v_total, v_pct);

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION record_watch_time(uuid, uuid, real, real) TO authenticated;


-- ============================================================
-- 2. SAVED / BOOKMARKED FILES
-- Quick save button  stronger signal than likes (Instagram data).
-- ============================================================
CREATE TABLE IF NOT EXISTS saved_files (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES files (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, file_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_files_user_created
  ON saved_files (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_saved_files_file
  ON saved_files (file_id);

ALTER TABLE saved_files ENABLE ROW LEVEL SECURITY;

-- Toggle save (like toggle_like pattern)
CREATE OR REPLACE FUNCTION toggle_save(
  p_user_id uuid,
  p_file_id uuid
)
RETURNS TABLE (saved boolean, save_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existed boolean;
  v_count bigint;
BEGIN
  IF p_user_id IS NULL OR p_file_id IS NULL THEN
    RETURN QUERY SELECT false, 0::bigint;
    RETURN;
  END IF;

  -- Check if already saved
  DELETE FROM saved_files
  WHERE user_id = p_user_id AND file_id = p_file_id;

  IF FOUND THEN
    v_existed := true;
  ELSE
    v_existed := false;
    INSERT INTO saved_files (user_id, file_id) VALUES (p_user_id, p_file_id);
  END IF;

  SELECT COUNT(*) INTO v_count FROM saved_files WHERE file_id = p_file_id;

  RETURN QUERY SELECT (NOT v_existed), v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION toggle_save(uuid, uuid) TO authenticated;


-- ============================================================
-- 3. USER INTEREST PROFILES
-- Pre-computed per-category scores based on ALL interactions.
-- Refreshed periodically (e.g. on login or every few hours).
-- ============================================================
CREATE TABLE IF NOT EXISTS user_interest_scores (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category text NOT NULL,
  score real NOT NULL DEFAULT 0,
  interaction_count int NOT NULL DEFAULT 0,
  last_updated timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category)
);

CREATE INDEX IF NOT EXISTS idx_user_interest_scores_user_score
  ON user_interest_scores (user_id, score DESC);

ALTER TABLE user_interest_scores ENABLE ROW LEVEL SECURITY;

-- Recompute interest scores for a user from all their interactions.
-- Weights: watch_time(5x) + saves(4x) + comments(4x) + likes(3x) + shares(3x) - dislikes(2x)
-- Each signal decays with age (half-life 30 days, floored at 0.15) so the
-- profile tracks what the user is into NOW instead of what they binged a
-- year ago. Old interests fade but never fully vanish.
CREATE OR REPLACE FUNCTION recompute_user_interests(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;

  DELETE FROM user_interest_scores WHERE user_id = p_user_id;

  INSERT INTO user_interest_scores (user_id, category, score, interaction_count, last_updated)
  SELECT
    p_user_id,
    cat.value,
    SUM(
      signals.weight
      * GREATEST(
          POWER(0.5, EXTRACT(EPOCH FROM (now() - signals.ts)) / (86400.0 * 30.0)),
          0.15
        )
    )::real AS score,
    COUNT(DISTINCT signals.file_id)::int AS interaction_count,
    now()
  FROM (
    -- Likes: weight 3
    SELECT l.file_id, 3.0 AS weight, l.created_at AS ts
    FROM likes l WHERE l.user_id = p_user_id
    UNION ALL
    -- Dislikes: weight -2
    SELECT d.file_id, -2.0, d.created_at
    FROM dislike d WHERE d.user_id = p_user_id
    UNION ALL
    -- Watch time: weight based on percentage (0-5)
    SELECT wt.file_id, LEAST(wt.watch_percentage * 5.0, 5.0), wt.created_at
    FROM file_watch_time wt WHERE wt.user_id = p_user_id
    UNION ALL
    -- Saves: weight 4
    SELECT sf.file_id, 4.0, sf.created_at
    FROM saved_files sf WHERE sf.user_id = p_user_id
    UNION ALL
    -- Comments: weight 4
    SELECT c.file_id, 4.0, c.created_at
    FROM comments c WHERE c.user_id = p_user_id AND c.is_deleted = false
  ) signals
  JOIN files f ON f.id = signals.file_id
  CROSS JOIN LATERAL jsonb_array_elements_text(f.categories) AS cat(value)
  WHERE f.categories IS NOT NULL
    AND jsonb_typeof(f.categories) = 'array'
  GROUP BY cat.value
  HAVING SUM(
    signals.weight
    * GREATEST(
        POWER(0.5, EXTRACT(EPOCH FROM (now() - signals.ts)) / (86400.0 * 30.0)),
        0.15
      )
  ) > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION recompute_user_interests(uuid) TO authenticated;


-- ============================================================
-- 4. CREATOR AFFINITY
-- Per-creator engagement scores. Boosts content from creators
-- the user engages with heavily, EVEN if not subscribed.
-- ============================================================
CREATE TABLE IF NOT EXISTS user_creator_affinity (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  creator_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  affinity_score real NOT NULL DEFAULT 0,
  interaction_count int NOT NULL DEFAULT 0,
  last_interaction timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, creator_id)
);

CREATE INDEX IF NOT EXISTS idx_user_creator_affinity_user_score
  ON user_creator_affinity (user_id, affinity_score DESC);

ALTER TABLE user_creator_affinity ENABLE ROW LEVEL SECURITY;

-- Recompute creator affinity from all interactions.
-- Same recency decay as recompute_user_interests (half-life 30 days,
-- floored at 0.15): creators you engaged with recently rank above ones
-- you binged months ago.
CREATE OR REPLACE FUNCTION recompute_creator_affinity(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;

  DELETE FROM user_creator_affinity WHERE user_id = p_user_id;

  INSERT INTO user_creator_affinity (user_id, creator_id, affinity_score, interaction_count, last_interaction)
  SELECT
    p_user_id,
    f.owner_id,
    SUM(
      signals.weight
      * GREATEST(
          POWER(0.5, EXTRACT(EPOCH FROM (now() - signals.ts)) / (86400.0 * 30.0)),
          0.15
        )
    )::real AS affinity_score,
    COUNT(DISTINCT signals.file_id)::int AS interaction_count,
    MAX(signals.ts) AS last_interaction
  FROM (
    SELECT l.file_id, 3.0 AS weight, l.created_at AS ts FROM likes l WHERE l.user_id = p_user_id
    UNION ALL
    SELECT d.file_id, -2.0, d.created_at FROM dislike d WHERE d.user_id = p_user_id
    UNION ALL
    SELECT wt.file_id, LEAST(wt.watch_percentage * 5.0, 5.0), wt.created_at
    FROM file_watch_time wt WHERE wt.user_id = p_user_id
    UNION ALL
    SELECT sf.file_id, 4.0, sf.created_at FROM saved_files sf WHERE sf.user_id = p_user_id
    UNION ALL
    SELECT c.file_id, 4.0, c.created_at FROM comments c
    WHERE c.user_id = p_user_id AND c.is_deleted = false
  ) signals
  JOIN files f ON f.id = signals.file_id
  WHERE f.owner_id != p_user_id  -- Don't track affinity to yourself
  GROUP BY f.owner_id
  HAVING SUM(
    signals.weight
    * GREATEST(
        POWER(0.5, EXTRACT(EPOCH FROM (now() - signals.ts)) / (86400.0 * 30.0)),
        0.15
      )
  ) > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION recompute_creator_affinity(uuid) TO authenticated;


-- ============================================================
-- 5. NEGATIVE SIGNALS
-- "Not interested" / "Don't show this creator" / "Hide category"
-- ============================================================
CREATE TABLE IF NOT EXISTS feed_negative_signals (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  file_id uuid NULL REFERENCES files (id) ON DELETE CASCADE,
  creator_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  category text NULL,
  signal_type text NOT NULL CHECK (signal_type IN ('not_interested', 'hide_creator', 'hide_category')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feed_negative_signals_user
  ON feed_negative_signals (user_id, signal_type);

CREATE INDEX IF NOT EXISTS idx_feed_negative_signals_user_creator
  ON feed_negative_signals (user_id, creator_id) WHERE creator_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_feed_negative_signals_user_category
  ON feed_negative_signals (user_id, category) WHERE category IS NOT NULL;

ALTER TABLE feed_negative_signals ENABLE ROW LEVEL SECURITY;

-- Add a negative signal
CREATE OR REPLACE FUNCTION add_negative_signal(
  p_user_id uuid,
  p_signal_type text,
  p_file_id uuid DEFAULT NULL,
  p_creator_id uuid DEFAULT NULL,
  p_category text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category text;
BEGIN
  IF p_user_id IS NULL OR p_signal_type IS NULL THEN
    RETURN false;
  END IF;

  v_category := CASE
    WHEN p_signal_type = 'hide_category' AND p_category IS NOT NULL THEN left(btrim(p_category), 128)
    ELSE NULL
  END;

  IF p_signal_type = 'hide_category' AND (v_category IS NULL OR length(v_category) = 0) THEN
    RETURN false;
  END IF;

  -- Prevent duplicate signals
  IF p_signal_type = 'not_interested' AND p_file_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM feed_negative_signals WHERE user_id = p_user_id AND file_id = p_file_id AND signal_type = 'not_interested') THEN
      RETURN true;
    END IF;
  ELSIF p_signal_type = 'hide_creator' AND p_creator_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM feed_negative_signals WHERE user_id = p_user_id AND creator_id = p_creator_id AND signal_type = 'hide_creator') THEN
      RETURN true;
    END IF;
  ELSIF p_signal_type = 'hide_category' AND v_category IS NOT NULL AND length(v_category) > 0 THEN
    IF EXISTS (SELECT 1 FROM feed_negative_signals WHERE user_id = p_user_id AND category = v_category AND signal_type = 'hide_category') THEN
      RETURN true;
    END IF;
  END IF;

  INSERT INTO feed_negative_signals (user_id, file_id, creator_id, category, signal_type)
  VALUES (p_user_id, p_file_id, p_creator_id, v_category, p_signal_type);

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION add_negative_signal(uuid, text, uuid, uuid, text) TO authenticated;


-- ============================================================
-- 6. HELPER: Recompute all personalization data for a user
-- Call on login or periodically
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_user_personalization(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;
  PERFORM recompute_user_interests(p_user_id);
  PERFORM recompute_creator_affinity(p_user_id);
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_user_personalization(uuid) TO authenticated;


-- ============================================================
-- 7. RLS policies  own-row SELECT for authenticated (defense in depth).
-- Server service role bypasses RLS; these help if tables are ever queried with a user JWT.
-- ============================================================
DROP POLICY IF EXISTS "file_watch_time_select_own" ON file_watch_time;
CREATE POLICY "file_watch_time_select_own" ON file_watch_time
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "saved_files_select_own" ON saved_files;
CREATE POLICY "saved_files_select_own" ON saved_files
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_interest_scores_select_own" ON user_interest_scores;
CREATE POLICY "user_interest_scores_select_own" ON user_interest_scores
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_creator_affinity_select_own" ON user_creator_affinity;
CREATE POLICY "user_creator_affinity_select_own" ON user_creator_affinity
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "feed_negative_signals_select_own" ON feed_negative_signals;
CREATE POLICY "feed_negative_signals_select_own" ON feed_negative_signals
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
