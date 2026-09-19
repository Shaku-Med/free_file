-- Playlist covers must not advertise content that is not listable.
--
-- get_user_playlists picked its cover with:
--
--   SELECT ... FROM playlist_items pi2 JOIN files f ON f.id = pi2.file_id
--   WHERE pi2.playlist_id = p.id ORDER BY pi2.position ASC LIMIT 1
--
-- No visibility filter at all. Drop a private or unlisted video into a
-- playlist and its thumbnail was published wherever that playlist appeared,
-- including on a public profile. The function is SECURITY DEFINER, so RLS was
-- not going to catch it either.
--
-- Two changes: filter the candidate rows to files the whole world may see, and
-- take the most recently added one rather than the lowest position, which is
-- what the product actually wants the cover to be.
--
-- The application resolves covers itself as well (see playlistCovers.server.ts,
-- which additionally drops files whose owner is under moderation). This keeps
-- the RPC honest for any other caller.

CREATE OR REPLACE FUNCTION get_user_playlists(p_user_id uuid)
RETURNS TABLE (
  id            uuid,
  created_at    timestamptz,
  updated_at    timestamptz,
  title         text,
  description   text,
  is_public     boolean,
  thumbnail_url text,
  unique_id     text,
  item_count    bigint,
  first_thumb   text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.created_at,
    p.updated_at,
    p.title,
    p.description,
    p.is_public,
    p.thumbnail_url,
    p.unique_id,
    COALESCE(ic.cnt, 0)::bigint AS item_count,
    ft.thumb AS first_thumb
  FROM playlists p
  LEFT JOIN LATERAL (
    SELECT count(*)::bigint AS cnt
    FROM playlist_items pi
    WHERE pi.playlist_id = p.id
  ) ic ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(f.default_thumbnail, trim(both '"' from f.thumbnails[1]::text)) AS thumb
    FROM playlist_items pi2
    JOIN files f ON f.id = pi2.file_id
    WHERE pi2.playlist_id = p.id
      -- is_public is kept as (visibility = 'public') by a trigger, so this
      -- excludes unlisted and private in one condition.
      AND f.is_public = true
      AND f.is_adult IS NOT TRUE
    ORDER BY pi2.added_at DESC
    LIMIT 1
  ) ft ON true
  WHERE p.owner_id = p_user_id
  ORDER BY p.updated_at DESC;
$$;

REVOKE ALL ON FUNCTION get_user_playlists(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_user_playlists(uuid) TO service_role;
