-- ============================================================
-- AUDIO FINGERPRINTS v6  RETIRE the Supabase table (moved to VPS SQLite)
-- ============================================================
-- Matching now runs on the VPS inside GoUpload (lib/fingerprintdb, SQLite).
-- The raw hashes never leave the box; GoUpload sends only the resulting
-- original link, and the app writes files.original_file_id directly.
--
-- ⚠️  RUN THIS ONLY AFTER:
--   1. Deploying the new GoUpload (SQLite matcher live), AND
--   2. Running the one-time import and verifying the row count:
--        docker exec -e SUPABASE_URL=... -e SUPABASE_SERVICE_KEY=... goupload \
--          /app/goupload -migrate-fingerprints
--        docker exec goupload sh -c \
--          "apk add --no-cache sqlite >/dev/null 2>&1; \
--           sqlite3 /data/fingerprints/fp.db 'SELECT COUNT(*) FROM audio_fingerprints;'"
--      (the count should be close to the Supabase table's row count)
--
-- files.original_file_id STAYS  it's still how the app links duplicates.
-- Only the big prints table + its RPC go away.
--
-- Run in the Supabase SQL Editor. Irreversible (drops the data).
-- ============================================================

BEGIN;

-- 1. Remove the RPC that fed the old table.
DROP FUNCTION IF EXISTS public.register_audio_fingerprints(text, bigint[], int[], int);

-- 2. Empty then drop the fingerprints table (302k+ rows freed from Postgres).
TRUNCATE TABLE public.audio_fingerprints;
DROP TABLE IF EXISTS public.audio_fingerprints;

COMMIT;

-- Sanity: this should now error with "relation does not exist", confirming the
-- table is gone and your Supabase database size dropped.
-- SELECT COUNT(*) FROM public.audio_fingerprints;
