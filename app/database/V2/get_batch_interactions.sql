-- Live like / dislike / comment counts and viewer state for many files at once.
-- Used by enrichFeedFilesWithInteractions and playlist APIs.

CREATE OR REPLACE FUNCTION get_batch_interactions(
  p_file_ids uuid[],
  p_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  file_id uuid,
  like_count bigint,
  dislike_count bigint,
  comment_count bigint,
  user_has_liked boolean,
  user_has_disliked boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    fid AS file_id,
    (SELECT COUNT(*)::bigint FROM likes l WHERE l.file_id = fid) AS like_count,
    (SELECT COUNT(*)::bigint FROM dislike d WHERE d.file_id = fid) AS dislike_count,
    (SELECT COUNT(*)::bigint FROM comments c WHERE c.file_id = fid AND c.is_deleted = false) AS comment_count,
    (p_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM likes l WHERE l.file_id = fid AND l.user_id = p_user_id)) AS user_has_liked,
    (p_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM dislike d WHERE d.file_id = fid AND d.user_id = p_user_id)) AS user_has_disliked
  FROM unnest(p_file_ids) AS fid
  WHERE fid IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION get_batch_interactions(uuid[], uuid) TO authenticated;
