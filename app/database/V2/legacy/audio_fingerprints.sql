-- ============================================================
-- AUDIO FINGERPRINTS  Shazam-style duplicate / original detection
-- ============================================================
-- GoUpload fingerprints every upload's audio (constellation pair hashes).
-- This is the inverted index + the one-shot matcher:
--
--   register_audio_fingerprints(unique_id, hashes[], offsets[])
--     1. stores the fingerprints (replacing any previous rows for the file)
--     2. looks up which existing files share those hashes
--     3. votes on (their_offset - our_offset)  one dominant delta = same
--        recording; scattered deltas = coincidence
--     4. links files.original_file_id to the matched file's ROOT original
--
-- Matching cost is independent of catalog size (hash index lookup), which
-- is the whole point  never scan files pairwise.
--
-- Scale note: ~4-8k rows per upload. At very large catalogs, partition this
-- table by hash range or move the index to a KV store; the function
-- signature stays the same. Run in Supabase SQL Editor.
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

-- ------------------------------------------------------------
-- register_audio_fingerprints  store + match + link, one round trip.
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
  v_file_id      uuid;
  v_match_file   uuid;
  v_votes        int;
  v_delta        int;
  v_root         uuid;
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

  -- Replace any previous fingerprints for this file (idempotent on retry).
  DELETE FROM audio_fingerprints WHERE file_id = v_file_id;
  INSERT INTO audio_fingerprints (hash, file_id, t_offset)
  SELECT h, v_file_id, o
  FROM unnest(p_hashes, p_offsets) AS q(h, o);

  -- Vote: same recording = many shared hashes agreeing on ONE offset delta.
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

  IF v_match_file IS NULL THEN
    -- No match  this upload is an original; clear any stale link.
    UPDATE files SET original_file_id = NULL WHERE id = v_file_id AND original_file_id IS NOT NULL;
    RETURN jsonb_build_object('ok', true, 'matched', false);
  END IF;

  -- Link to the matched file's ROOT (subs of subs all point at one original).
  SELECT COALESCE(f.original_file_id, f.id) INTO v_root
  FROM files f WHERE f.id = v_match_file;

  IF v_root = v_file_id THEN
    -- Degenerate self-loop guard (shouldn't happen; new uploads are newest).
    RETURN jsonb_build_object('ok', true, 'matched', false);
  END IF;

  UPDATE files SET original_file_id = v_root WHERE id = v_file_id;

  RETURN jsonb_build_object(
    'ok', true,
    'matched', true,
    'original_file_id', v_root,
    'votes', v_votes,
    'offset_delta', v_delta
  );
END $$;

REVOKE ALL ON FUNCTION public.register_audio_fingerprints(text, bigint[], int[], int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_audio_fingerprints(text, bigint[], int[], int) TO service_role;
