-- Owner-only file row for edit modal prefill. Caller must pass authenticated user id from the app server.
-- p_lookup: files.id (uuid as text) or files.unique_id

CREATE OR REPLACE FUNCTION public.get_file_for_owner_edit(p_lookup text, p_viewer_id uuid)
RETURNS SETOF public.files
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT f.*
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
