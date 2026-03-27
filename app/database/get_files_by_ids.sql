-- ============================================================
-- get_files_by_ids — fetch file rows by ID list (for playlist, etc.)
-- ============================================================
-- SECURITY DEFINER so anon/authenticated can load playlist data
-- regardless of RLS on files. Only returns completed/public-ready files.
-- Run in Supabase SQL Editor.
-- ============================================================

DROP FUNCTION IF EXISTS get_files_by_ids(uuid[]);

CREATE OR REPLACE FUNCTION get_files_by_ids(p_ids uuid[])
RETURNS TABLE (
  id               uuid,
  created_at       timestamptz,
  endpoint         text,
  filename         text,
  unique_id        text,
  file_size        text,
  file_type        text,
  is_adult         boolean,
  owner_id         uuid,
  is_public        boolean,
  file_description text,
  file_title       text,
  default_thumbnail text,
  view_count       numeric,
  share_count      numeric,
  is_reel          boolean,
  duration         numeric,
  categories       jsonb,
  tags             jsonb,
  colors           jsonb,
  metadata         jsonb,
  upload_status    text,
  owner_username   text,
  owner_profile_pic text,
  owner_verified   boolean
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
    f.is_adult,
    f.owner_id,
    f.is_public,
    f.file_description,
    f.file_title,
    f.default_thumbnail,
    f.view_count,
    f.share_count,
    f.is_reel,
    f.duration,
    f.categories,
    f.tags,
    f.colors,
    f.metadata,
    f.upload_status,
    u.username AS owner_username,
    u.profile_pic AS owner_profile_pic,
    COALESCE(u.verified, false) AS owner_verified
  FROM files f
  LEFT JOIN users u ON u.id = f.owner_id
  WHERE f.id = ANY(p_ids)
    AND f.upload_status IN ('complete', 'completed')
  ORDER BY array_position(p_ids, f.id);
$$;

GRANT EXECUTE ON FUNCTION get_files_by_ids(uuid[]) TO anon;
GRANT EXECUTE ON FUNCTION get_files_by_ids(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION get_files_by_ids(uuid[]) TO service_role;
