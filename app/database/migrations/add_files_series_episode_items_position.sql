-- Per-episode ordering for the FILES inside a series episode. Without this,
-- items sort by upload time; this lets owners drag-reorder the videos.
-- Safe to run repeatedly.

ALTER TABLE public.files_series_episode_items
  ADD COLUMN IF NOT EXISTS "position" integer;

-- Backfill existing rows: number them within each episode by the file's upload
-- time, so current ordering is preserved as the starting point.
WITH ordered AS (
  SELECT
    i.id,
    ROW_NUMBER() OVER (
      PARTITION BY i.file_episode_id
      ORDER BY f.created_at ASC, f.unique_id ASC
    ) AS rn
  FROM public.files_series_episode_items i
  JOIN public.files f ON f.unique_id = i.file_id
)
UPDATE public.files_series_episode_items i
SET "position" = o.rn
FROM ordered o
WHERE o.id = i.id
  AND i."position" IS NULL;

CREATE INDEX IF NOT EXISTS idx_fsei_episode_position
  ON public.files_series_episode_items (file_episode_id, "position");
