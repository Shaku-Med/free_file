-- ============================================================
-- Migration: series table + episode columns on files
-- ============================================================

-- 1. Create series table
CREATE TABLE IF NOT EXISTS public.series (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  created_at    timestamptz NULL     DEFAULT now(),
  updated_at    timestamptz NULL     DEFAULT now(),
  owner_id      uuid        NOT NULL,
  title         text        NOT NULL,
  description   text        NULL,
  thumbnail_url text        NULL,
  unique_id     text        NOT NULL,
  is_public     boolean     NOT NULL DEFAULT true,
  CONSTRAINT series_pkey         PRIMARY KEY (id),
  CONSTRAINT series_unique_id_key UNIQUE (unique_id),
  CONSTRAINT series_owner_id_fkey FOREIGN KEY (owner_id)
    REFERENCES public.users (id) ON DELETE CASCADE,
  CONSTRAINT series_title_length CHECK (char_length(title) <= 100),
  CONSTRAINT series_desc_length  CHECK (description IS NULL OR char_length(description) <= 1000)
);

CREATE INDEX IF NOT EXISTS idx_series_owner     ON public.series USING btree (owner_id);
CREATE INDEX IF NOT EXISTS idx_series_unique_id ON public.series USING btree (unique_id);

-- 2. Add episode columns to files
ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS series_id       uuid    NULL,
  ADD COLUMN IF NOT EXISTS season_number   integer NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS episode_number  integer NULL,
  -- is_series_main = true  → this is the "cover" file shown in feeds
  -- is_series_main = false → sub-episode, hidden from feeds/search/recommendations
  ADD COLUMN IF NOT EXISTS is_series_main  boolean NOT NULL DEFAULT false;

-- 3. FK: files.series_id → series.id (SET NULL on cascade so deleting series doesn't delete files)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'files_series_id_fkey'
  ) THEN
    ALTER TABLE public.files
      ADD CONSTRAINT files_series_id_fkey
      FOREIGN KEY (series_id) REFERENCES public.series (id) ON DELETE SET NULL;
  END IF;
END $$;

-- 4. Index for fast episode ordering lookups
CREATE INDEX IF NOT EXISTS idx_files_series
  ON public.files USING btree (series_id, season_number, episode_number);
