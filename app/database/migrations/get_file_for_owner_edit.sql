-- Owner-only file row for edit modal prefill. Caller must pass authenticated user id from the app server.
-- p_lookup: files.id (uuid as text) or files.unique_id
--
-- IMPORTANT: Do not return github_repo (or switch back to SELECT f.* / SETOF files). That column is
-- server-only for GitHub raw URL resolution; clients must never receive it.

DROP FUNCTION IF EXISTS public.get_file_for_owner_edit(text, uuid);

CREATE OR REPLACE FUNCTION public.get_file_for_owner_edit(p_lookup text, p_viewer_id uuid)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  endpoint text,
  filename text,
  unique_id text,
  file_size text,
  file_type text,
  up_count numeric,
  down_count numeric,
  is_adult boolean,
  owner_id uuid,
  is_public boolean,
  file_description text,
  category jsonb[],
  file_title text,
  thumbnails jsonb[],
  views numeric,
  shares numeric,
  view_count numeric,
  share_count numeric,
  is_reel boolean,
  duration numeric,
  upload_status text,
  categories jsonb,
  tags jsonb,
  colors jsonb,
  metadata jsonb,
  comments_enabled boolean,
  default_thumbnail text,
  comment_limit integer,
  is_series_main boolean,
  file_series_id uuid,
  file_series_episode_id uuid,
  is_files_series_item boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    f.id,
    f.created_at,
    f.endpoint,
    f.filename,
    f.unique_id,
    f.file_size,
    f.file_type,
    f.up_count,
    f.down_count,
    f.is_adult,
    f.owner_id,
    f.is_public,
    f.file_description,
    f.category,
    f.file_title,
    f.thumbnails,
    f.views,
    f.shares,
    f.view_count,
    f.share_count,
    f.is_reel,
    f.duration,
    f.upload_status,
    f.categories,
    f.tags,
    f.colors,
    f.metadata,
    f.comments_enabled,
    f.default_thumbnail,
    f.comment_limit,
    f.is_series_main,
    f.file_series_id,
    f.file_series_episode_id,
    f.is_files_series_item
  FROM public.files f
  WHERE f.owner_id = p_viewer_id
    AND (
      f.id::text = trim(p_lookup)
      OR f.unique_id = trim(p_lookup)
    )
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_file_for_owner_edit(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_file_for_owner_edit(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_file_for_owner_edit(text, uuid) TO service_role;
