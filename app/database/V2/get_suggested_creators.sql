-- ============================================================
-- get_suggested_creators — "People you may know" for the feed
-- ============================================================
-- Friend-of-friend discovery: the people the accounts you follow also
-- follow, ranked by how many of your follows overlap (mutual count).
-- Tops up with popular creators so the row is never empty (cold start /
-- sparse graphs). Excludes self, already-followed, hidden creators, and
-- any ids the caller already showed (so different positions in the feed
-- surface different people).
--
-- SECURITY: SECURITY DEFINER, returns only PUBLIC profile fields. The
-- viewer's own follow/hidden graph is scoped by p_user_id, which is always
-- supplied server-side from the authenticated session.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_suggested_creators(uuid, int, uuid[]);

CREATE OR REPLACE FUNCTION public.get_suggested_creators(
  p_user_id     uuid,
  p_limit       int    DEFAULT 12,
  p_exclude_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS TABLE (
  id               uuid,
  username         text,
  profile_pic      text,
  verified         boolean,
  about            text,
  subscriber_count bigint,
  mutual_count     bigint,
  reason           text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  my_subs AS (
    SELECT s.channel_id
    FROM subscriptions s
    WHERE p_user_id IS NOT NULL AND s.subscriber_id = p_user_id
  ),
  hidden AS (
    SELECT ns.creator_id
    FROM feed_negative_signals ns
    WHERE p_user_id IS NOT NULL
      AND ns.user_id = p_user_id
      AND ns.signal_type = 'hide_creator'
      AND ns.creator_id IS NOT NULL
  ),
  -- creators followed by the people the viewer follows
  fof AS (
    SELECT s.channel_id AS uid, count(*)::bigint AS mutual
    FROM subscriptions s
    JOIN my_subs ms ON ms.channel_id = s.subscriber_id
    WHERE s.channel_id <> COALESCE(p_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
    GROUP BY s.channel_id
  ),
  sub_counts AS (
    SELECT channel_id, count(*)::bigint AS cnt
    FROM subscriptions
    GROUP BY channel_id
  ),
  candidates AS (
    SELECT f.uid, f.mutual, 0 AS pri FROM fof f
    UNION ALL
    SELECT u.id, 0::bigint, 1 FROM users u WHERE u.is_memories = false
  ),
  ranked AS (
    SELECT c.uid, max(c.mutual) AS mutual, min(c.pri) AS pri
    FROM candidates c
    GROUP BY c.uid
  )
  SELECT
    u.id,
    u.username,
    u.profile_pic,
    u.verified,
    u.about,
    COALESCE(sc.cnt, 0) AS subscriber_count,
    r.mutual            AS mutual_count,
    CASE WHEN r.pri = 0 THEN 'mutual' ELSE 'popular' END AS reason
  FROM ranked r
  JOIN users u ON u.id = r.uid
  LEFT JOIN sub_counts sc ON sc.channel_id = u.id
  WHERE u.is_memories = false
    AND (p_user_id IS NULL OR u.id <> p_user_id)
    AND u.id NOT IN (SELECT channel_id FROM my_subs)
    AND u.id NOT IN (SELECT creator_id FROM hidden)
    AND (p_exclude_ids = '{}'::uuid[] OR u.id <> ALL(p_exclude_ids))
  ORDER BY r.pri ASC, r.mutual DESC, subscriber_count DESC, u.id
  LIMIT GREATEST(LEAST(p_limit, 50), 0);
$$;

REVOKE ALL ON FUNCTION public.get_suggested_creators(uuid, int, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.get_suggested_creators(uuid, int, uuid[]) TO anon, authenticated;
