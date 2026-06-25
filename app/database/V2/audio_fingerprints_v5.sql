-- ============================================================
-- AUDIO FINGERPRINTS v5  Shazam-style duplicate / original detection
-- ============================================================
-- v5 = v4 + RATIO GATE (kills "different song linked to another's original").
--
-- Why v4 still mis-matched: it required 25 DISTINCT hashes aligning on one
-- offset delta. That is an ABSOLUTE count. A long track has thousands of
-- distinct hashes, so two genuinely different songs can share ~25 of them at
-- some delta purely by chance (~1% overlap) and sail past the bar. A real
-- re-upload instead shares the MAJORITY of its hashes at one alignment.
--
-- v5 keeps everything v4 does and adds one rule: the winning alignment must
-- also cover a real FRACTION of the query's distinct (non stop-word) hashes,
-- not just an absolute count. So:
--
--   need votes >= GREATEST(p_min_votes, ceil(MATCH_RATIO * query_distinct))
--
-- A re-upload shares most of its hashes (ratio ~1.0) and passes easily; an
-- unrelated song shares a sliver (ratio ~0.01) and is rejected even on long
-- tracks where the raw count crept past 25.
--
-- Unchanged from v4: distinct-hash votes, >16x stop-word hashes excluded,
-- match first / store nothing for subs, reels can never become originals,
-- idempotent.
--
-- If an upload was already mis-linked, unlink it manually:
--   UPDATE files SET original_file_id = NULL WHERE unique_id = '<that upload id>';
--
-- Run in Supabase SQL Editor (idempotent; safe over v3/v4).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.audio_fingerprints (
  hash     bigint NOT NULL,
  file_id  uuid   NOT NULL REFERENCES public.files (id) ON DELETE CASCADE,
  t_offset int    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audio_fingerprints_hash
  ON public.audio_fingerprints (hash);

CREATE INDEX IF NOT EXISTS idx_audio_fingerprints_file
  ON public.audio_fingerprints (file_id);

ALTER TABLE public.audio_fingerprints ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: server-side only (service_role / SECURITY DEFINER).

ALTER TABLE public.files ADD COLUMN IF NOT EXISTS original_file_id uuid NULL
  REFERENCES public.files (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_files_original_file
  ON public.files (original_file_id) WHERE original_file_id IS NOT NULL;

DELETE FROM public.audio_fingerprints af
USING public.files f
WHERE af.file_id = f.id
  AND (f.original_file_id IS NOT NULL OR f.is_reel IS TRUE);

-- ------------------------------------------------------------
-- register_audio_fingerprints  match first, store only non-reel originals.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.register_audio_fingerprints(text, bigint[], int[], int);

CREATE OR REPLACE FUNCTION public.register_audio_fingerprints(
  p_unique_id text,
  p_hashes    bigint[],
  p_offsets   int[],
  p_min_votes int DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Fraction of the query's distinct hashes the best alignment must cover.
  -- 0.18 = "almost a fifth of this clip's hashes line up with that file".
  c_match_ratio constant double precision := 0.18;
  v_file_id    uuid;
  v_is_reel    boolean;
  v_match_file uuid;
  v_votes      int;
  v_delta      int;
  v_root       uuid;
BEGIN
  IF p_unique_id IS NULL OR p_unique_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;
  IF p_hashes IS NULL OR p_offsets IS NULL
     OR array_length(p_hashes, 1) IS DISTINCT FROM array_length(p_offsets, 1)
     OR array_length(p_hashes, 1) < 1
     OR array_length(p_hashes, 1) > 10000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;

  SELECT f.id, COALESCE(f.is_reel, false)
  INTO v_file_id, v_is_reel
  FROM files f WHERE f.unique_id = p_unique_id;
  IF v_file_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  -- Match FIRST, straight from the query arrays  nothing written yet.
  -- Same recording = many DIFFERENT hashes agreeing on ONE offset delta AND
  -- covering a real fraction of this clip's hashes. Hashes repeating > 16x in
  -- the query are periodic-beat noise and don't get to vote.
  WITH q AS (
    SELECT t.h, t.o FROM unnest(p_hashes, p_offsets) AS t(h, o)
  ),
  q_clean AS (
    SELECT q.h, q.o
    FROM q
    JOIN (SELECT h FROM q GROUP BY h HAVING COUNT(*) <= 16) keep ON keep.h = q.h
  ),
  q_stats AS (
    SELECT COUNT(DISTINCT h)::int AS total FROM q_clean
  ),
  scored AS (
    SELECT
      af.file_id,
      (af.t_offset - qc.o) AS delta,
      COUNT(DISTINCT qc.h)::int AS votes
    FROM q_clean qc
    JOIN audio_fingerprints af ON af.hash = qc.h
    WHERE af.file_id <> v_file_id
    GROUP BY af.file_id, (af.t_offset - qc.o)
    ORDER BY votes DESC
    LIMIT 1
  )
  SELECT s.file_id, s.votes, s.delta
  INTO v_match_file, v_votes, v_delta
  FROM scored s, q_stats
  WHERE s.votes >= GREATEST(p_min_votes, CEIL(c_match_ratio * q_stats.total));

  IF v_match_file IS NOT NULL THEN
    -- It's a SUB: link to the match's ROOT and store nothing.
    SELECT COALESCE(f.original_file_id, f.id) INTO v_root
    FROM files f WHERE f.id = v_match_file;

    IF v_root <> v_file_id THEN
      UPDATE files SET original_file_id = v_root WHERE id = v_file_id;
      DELETE FROM audio_fingerprints WHERE file_id = v_file_id;

      RETURN jsonb_build_object(
        'ok', true,
        'matched', true,
        'original_file_id', v_root,
        'votes', v_votes,
        'offset_delta', v_delta
      );
    END IF;
  END IF;

  -- No match. Drop stale state either way (re-process / webhook retry).
  DELETE FROM audio_fingerprints WHERE file_id = v_file_id;
  UPDATE files SET original_file_id = NULL
  WHERE id = v_file_id AND original_file_id IS NOT NULL;

  IF v_is_reel THEN
    RETURN jsonb_build_object('ok', true, 'matched', false, 'reel', true);
  END IF;

  -- This upload IS an original: store its prints (replace on retry).
  INSERT INTO audio_fingerprints (hash, file_id, t_offset)
  SELECT h, v_file_id, o
  FROM unnest(p_hashes, p_offsets) AS q(h, o);

  RETURN jsonb_build_object('ok', true, 'matched', false);
END $$;

REVOKE ALL ON FUNCTION public.register_audio_fingerprints(text, bigint[], int[], int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_audio_fingerprints(text, bigint[], int[], int) TO service_role;
