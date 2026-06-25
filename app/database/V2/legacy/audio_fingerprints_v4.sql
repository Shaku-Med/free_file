-- ============================================================
-- AUDIO FINGERPRINTS v4  Shazam-style duplicate / original detection
-- ============================================================
-- v4 = v3 + FALSE-POSITIVE FIX (different song matched as another's sub).
--
-- Why v3 mis-matched: steady beats (kick/snare every ~0.5s) emit the SAME
-- hash value hundreds of times. Between two DIFFERENT songs at a similar
-- tempo, that one repeating hash cross-joins into hundreds of "votes" all
-- agreeing on one offset delta  sailing past the 25-vote bar. v4 fixes
-- the vote semantics:
--
--   1. votes = COUNT(DISTINCT hash) per (file, delta). A true re-upload
--      shares hundreds of DIFFERENT hashes at one alignment; two different
--      songs share almost none beyond the repetitive beat hashes.
--   2. "Stop-word" hashes  any hash appearing > 16 times in the query
--      (periodic beats, drones)  are excluded from voting entirely.
--      This also caps the join fan-out, so matching gets CHEAPER.
--
-- Unchanged from v3: match first / store nothing for subs; reels can never
-- become originals; one-time cleanups are idempotent.
--
-- If an upload was already mis-linked by v3, unlink it manually:
--   UPDATE files SET original_file_id = NULL WHERE unique_id = '<that upload id>';
--
-- Run in Supabase SQL Editor (idempotent; safe over v3).
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

-- Original/sub relationship: NULL = this file IS an original.
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS original_file_id uuid NULL
  REFERENCES public.files (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_files_original_file
  ON public.files (original_file_id) WHERE original_file_id IS NOT NULL;

-- One-time cleanup: subs never store prints, and reels don't either.
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
  -- Same recording = many DIFFERENT hashes agreeing on ONE offset delta.
  -- Hashes repeating > 16x in the query are periodic-beat noise: they vote
  -- for every same-tempo song, so they don't get to vote at all.
  WITH q AS (
    SELECT t.h, t.o FROM unnest(p_hashes, p_offsets) AS t(h, o)
  ),
  q_clean AS (
    SELECT q.h, q.o
    FROM q
    JOIN (SELECT h FROM q GROUP BY h HAVING COUNT(*) <= 16) keep ON keep.h = q.h
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
  FROM scored s
  WHERE s.votes >= GREATEST(5, p_min_votes);

  IF v_match_file IS NOT NULL THEN
    -- It's a SUB: link to the match's ROOT and store nothing. Drop any
    -- prints this file may have from a previous run (e.g. it was an
    -- original before a re-process, or a webhook retry raced).
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

  -- Reels can never seed the index as an original sound.
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
