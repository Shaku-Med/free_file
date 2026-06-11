-- ============================================================
-- get_search_suggestions v2  typo-tolerant YouTube-style completions
-- ============================================================
-- v1 failed the real-world case: "got gen" found nothing for a file
-- titled "... GUT GENUG". Trigram fuzzy is mathematically weak on
-- short words ("got" vs "gut" share almost no trigrams), so v2 matches
-- WORD BY WORD instead: every typed token must either
--   1. prefix-match some word of the title/tag  ("gen" -> "genug"), or
--   2. be within edit distance 1 (<=4 chars) / 2 (longer) of some word
--      ("got" -> "gut")  via fuzzystrmatch levenshtein.
-- Run in Supabase SQL Editor.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

DROP FUNCTION IF EXISTS get_search_suggestions(text, int);

CREATE OR REPLACE FUNCTION public.get_search_suggestions(
  p_query text,
  p_limit int DEFAULT 8
)
RETURNS TABLE (suggestion text)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_q      text;
  v_tokens text[];
BEGIN
  v_q := lower(btrim(COALESCE(p_query, '')));
  IF length(v_q) < 1 OR length(v_q) > 80 THEN RETURN; END IF;

  -- Up to 6 tokens, 1-40 chars each, bounds the per-row work.
  SELECT array_agg(t) INTO v_tokens FROM (
    SELECT t
    FROM unnest(regexp_split_to_array(v_q, '[^a-z0-9]+')) AS t
    WHERE length(t) BETWEEN 1 AND 40
    LIMIT 6
  ) s;
  IF v_tokens IS NULL OR array_length(v_tokens, 1) = 0 THEN RETURN; END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      lower(btrim(f.file_title)) AS s,
      COALESCE(f.view_count, 0)::float AS pop
    FROM files f
    WHERE f.is_public = true
      AND f.is_adult = false
      AND f.upload_status = 'complete'
      AND f.file_title IS NOT NULL
      AND length(f.file_title) BETWEEN 2 AND 80

    UNION ALL

    SELECT lower(btrim(tag.value)) AS s, 0.0 AS pop
    FROM files f
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(f.tags, '[]'::jsonb)) AS tag(value)
    WHERE f.is_public = true
      AND f.is_adult = false
      AND f.upload_status = 'complete'
      AND length(tag.value) BETWEEN 2 AND 60
  ),
  -- Every query token must hit some word of the candidate (prefix or typo).
  matched AS (
    SELECT c.s, c.pop
    FROM candidates c
    WHERE c.s <> '' AND c.s <> v_q
      AND NOT EXISTS (
        SELECT 1 FROM unnest(v_tokens) AS qt(tok)
        WHERE NOT EXISTS (
          SELECT 1
          FROM unnest(regexp_split_to_array(c.s, '[^a-z0-9]+')) AS tw(w)
          WHERE tw.w <> ''
            AND (
              tw.w LIKE qt.tok || '%'
              OR (
                length(qt.tok) >= 3
                AND levenshtein(qt.tok, left(tw.w, 40))
                    <= CASE WHEN length(qt.tok) <= 4 THEN 1 ELSE 2 END
              )
            )
        )
      )
  ),
  ranked AS (
    SELECT
      m.s,
      CASE WHEN m.s LIKE v_q || '%' THEN 0 ELSE 1 END AS pref,
      COUNT(*) AS cnt,
      MAX(m.pop) AS pop
    FROM matched m
    GROUP BY m.s
  )
  SELECT r.s
  FROM ranked r
  ORDER BY r.pref ASC, r.cnt DESC, r.pop DESC, length(r.s) ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 8), 10));
END $$;

GRANT EXECUTE ON FUNCTION public.get_search_suggestions(text, int) TO anon, authenticated;
