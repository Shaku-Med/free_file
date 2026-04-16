-- Nested episodes: optional parent episode (same series). Self-FK; deleting parent removes children.
-- After this migration, apply database/V2/get_series_episodes_with_items_for_viewer.sql (updated RPC return shape).
ALTER TABLE public.files_series_episodes
  ADD COLUMN IF NOT EXISTS parent_episode_id uuid null;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'files_series_episodes_parent_episode_id_fkey'
  ) THEN
    ALTER TABLE public.files_series_episodes
      ADD CONSTRAINT files_series_episodes_parent_episode_id_fkey
      FOREIGN KEY (parent_episode_id) REFERENCES public.files_series_episodes (id)
      ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
END $$;
