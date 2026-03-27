-- Backfill default_thumbnail from the first real thumbnail in the thumbnails array.
-- Skips thumbnail_preview and .json entries.
-- After this, feeds/cards only need default_thumbnail, not the full thumbnails array.

UPDATE public.files
SET default_thumbnail = (
  SELECT trim(both '"' from elem::text)
  FROM unnest(thumbnails) AS elem
  WHERE elem::text NOT LIKE '%thumbnail_preview%'
    AND elem::text NOT LIKE '%.json'
    AND elem::text NOT LIKE '%waveform%'
  LIMIT 1
)
WHERE default_thumbnail IS NULL
  AND thumbnails IS NOT NULL
  AND array_length(thumbnails, 1) > 0;
