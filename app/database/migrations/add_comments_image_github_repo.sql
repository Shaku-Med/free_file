-- GitHub repo where the comment image blob was stored (matches Go GITHUB_REPO at upload).
-- Lets /api/load/image resolve the correct bucket when files.github_repo or env order is wrong.
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS image_github_repo text NULL DEFAULT 'Memories';

-- If the column already existed without a default (older run), attach the default.
ALTER TABLE public.comments
  ALTER COLUMN image_github_repo SET DEFAULT 'Memories';

COMMENT ON COLUMN public.comments.image_github_repo IS
  'GitHub repository name for comment image raw path (same as Go GITHUB_REPO when uploaded). Default Memories.';

-- Optional backfill for existing NULL rows only:
-- UPDATE public.comments SET image_github_repo = 'Memories'
-- WHERE image_url IS NOT NULL AND image_url LIKE '%/comments/%' AND image_github_repo IS NULL;
