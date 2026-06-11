-- ============================================================
-- AUDIO FINGERPRINTS v2  Shazam-style duplicate / original detection
-- ============================================================
-- v2 = v1 with the storage fix: SUBS DON'T STORE FINGERPRINTS.
-- Matching always runs against the ORIGINAL's prints, so keeping a copy
-- for every duplicate just multiplied index rows for nothing. Flow now:
--
--   register_audio_fingerprints(unique_id, hashes[], offsets[])
--     1. MATCH first: vote the query hashes against the existing index
--        (one dominant offset delta = same recording)
--     2. matched  -> link files.original_file_id to the match's root,
--                    DELETE any prints this file may have had, store NOTHING
--     3. no match -> this file IS an original: store its prints (replace)
--
-- Also prunes prints already stored for known subs (one-time cleanup).
-- Matching cost stays independent of catalog size (hash index lookup).
-- Run in Supabase SQL Editor (idempotent; safe over v1).
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

-- One-time cleanup: drop prints stored for files already flagged as subs.
DELETE FROM public.audio_fingerprints af
USING public.files f
WHERE af.file_id = f.id
  AND f.original_file_id IS NOT NULL;

-- ------------------------------------------------------------
-- register_audio_fingerprints  match first, store only originals.
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

  SELECT f.id INTO v_file_id FROM files f WHERE f.unique_id = p_unique_id;
  IF v_file_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  -- Match FIRST, straight from the query arrays  nothing written yet.
  -- Same recording = many shared hashes agreeing on ONE offset delta.
  SELECT s.file_id, s.votes, s.delta
  INTO v_match_file, v_votes, v_delta
  FROM (
    SELECT
      af.file_id,
      (af.t_offset - q.o) AS delta,
      COUNT(*)::int AS votes
    FROM unnest(p_hashes, p_offsets) AS q(h, o)
    JOIN audio_fingerprints af ON af.hash = q.h
    WHERE af.file_id <> v_file_id
    GROUP BY af.file_id, (af.t_offset - q.o)
    ORDER BY votes DESC
    LIMIT 1
  ) s
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

  -- No match  this upload IS an original: store its prints (replace on
  -- retry) and clear any stale sub link.
  DELETE FROM audio_fingerprints WHERE file_id = v_file_id;
  INSERT INTO audio_fingerprints (hash, file_id, t_offset)
  SELECT h, v_file_id, o
  FROM unnest(p_hashes, p_offsets) AS q(h, o);

  UPDATE files SET original_file_id = NULL
  WHERE id = v_file_id AND original_file_id IS NOT NULL;

  RETURN jsonb_build_object('ok', true, 'matched', false);
END $$;

REVOKE ALL ON FUNCTION public.register_audio_fingerprints(text, bigint[], int[], int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_audio_fingerprints(text, bigint[], int[], int) TO service_role;
