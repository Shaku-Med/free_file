-- ============================================================
-- get_search_suggestions  YouTube-style query completions
-- ============================================================
-- Cheap text suggestions for the navbar dropdown while the user types.
-- Pulls candidate phrases from public file TITLES and TAGS:
--   1. prefix matches first ("du bi" -> "du bist gut genug")
--   2. then word-boundary / fuzzy matches
-- ranked by how many files carry the phrase + their views. No video data
-- leaves the function  the full (vector) search runs only on Enter via
-- search_files. Run in Supabase SQL Editor.
-- ============================================================

DROP FUNCTION IF EXISTS get_search_suggestions(text, int);

CREATE OR REPLACE FUNCTION public.get_search_suggestions(
  p_query text,
  p_limit int DEFAULT 8
)
RETURNS TABLE (suggestion text)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_q text;
BEGIN
  v_q := lower(btrim(COALESCE(p_query, '')));
  IF length(v_q) < 1 OR length(v_q) > 80 THEN RETURN; END IF;

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
      AND (
           lower(f.file_title) LIKE v_q || '%'
        OR lower(f.file_title) LIKE '% ' || v_q || '%'
        OR v_q <% lower(f.file_title)
      )

    UNION ALL

    SELECT lower(btrim(tag.value)) AS s, 0.0 AS pop
    FROM files f
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(f.tags, '[]'::jsonb)) AS tag(value)
    WHERE f.is_public = true
      AND f.is_adult = false
      AND f.upload_status = 'complete'
      AND length(tag.value) BETWEEN 2 AND 60
      AND lower(tag.value) LIKE v_q || '%'
  ),
  ranked AS (
    SELECT
      c.s,
      CASE WHEN c.s LIKE v_q || '%' THEN 0 ELSE 1 END AS pref,
      COUNT(*) AS cnt,
      MAX(c.pop) AS pop
    FROM candidates c
    WHERE c.s <> '' AND c.s <> v_q
    GROUP BY c.s
  )
  SELECT r.s
  FROM ranked r
  ORDER BY r.pref ASC, r.cnt DESC, r.pop DESC, length(r.s) ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 8), 10));
END $$;

GRANT EXECUTE ON FUNCTION public.get_search_suggestions(text, int) TO anon, authenticated;
