-- ============================================================
-- get_video_endcards  Lightweight end-card suggestions
-- ============================================================
-- YouTube-style end-card grid that appears in the last ~20 seconds of a video.
-- Differences from get_endscreen_suggestions / the related-videos rail:
--   * NO REELS  reels are never recommended here; viewers should reach them
--     via the dedicated reel feed, not as a watch-next from a long-form video.
--   * Accepts `p_exclude_ids` so the caller can pass in whatever rows the
--     page is already rendering (related rail + series up-next). That way
--     the end-card panel surfaces a distinct slice, not duplicates of cards
--     already on screen.
-- Ranking comes from get_related (interest profile + creator affinity +
-- engagement score).
-- ============================================================

DROP FUNCTION IF EXISTS public.get_video_endcards(uuid, uuid, int, uuid[]);
DROP FUNCTION IF EXISTS public.get_video_endcards(uuid, uuid, int);

CREATE OR REPLACE FUNCTION public.get_video_endcards(
  p_file_id      uuid,
  p_user_id      uuid    DEFAULT NULL,
  p_limit        int     DEFAULT 4,
  p_exclude_ids  uuid[]  DEFAULT '{}'::uuid[]
)
RETURNS TABLE (
  id                 uuid,
  unique_id          text,
  file_title         text,
  filename           text,
  default_thumbnail  text,
  duration           numeric,
  view_count         numeric,
  is_reel            boolean,
  is_adult           boolean,
  is_public          boolean,
  created_at         timestamptz,
  owner_id           uuid,
  owner_username     text,
  owner_profile_pic  text,
  owner_verified     boolean
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  -- Pull a larger pool from get_related so reel-filtering / exclusion still
  -- leaves us enough rows, then trim to the requested limit on the outside.
  WITH pool AS (
    SELECT r.*
    FROM public.get_related(
      p_file_id,
      p_user_id,
      GREATEST(p_limit * 4, 16),
      0,
      COALESCE(p_exclude_ids, '{}'::uuid[]),
      '{}'::text[]
    ) r
    WHERE r.is_reel IS NOT TRUE
  )
  SELECT
    p.id,
    p.unique_id,
    p.file_title,
    p.filename,
    p.default_thumbnail,
    p.duration,
    p.view_count,
    p.is_reel,
    p.is_adult,
    p.is_public,
    p.created_at,
    p.owner_id,
    p.owner_username,
    p.owner_profile_pic,
    p.owner_verified
  FROM pool p
  LIMIT GREATEST(1, LEAST(p_limit, 8));
$$;

GRANT EXECUTE ON FUNCTION public.get_video_endcards(uuid, uuid, int, uuid[]) TO anon, authenticated;
