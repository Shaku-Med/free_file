-- file_engagement_stats v2: adds the playback-depth signal.
--
-- Supersedes database/default-schemas/file_engagement_status.sql. A materialized
-- view cannot gain columns through ALTER, so it is dropped and rebuilt. The DROP
-- is deliberately not CASCADE: if something else grew a dependency on this view,
-- this should fail loudly rather than quietly delete it.
--
-- The new idea: WHERE in a video someone acted matters as much as whether they
-- acted. A like at 90% means the video held them. A like at 3% is a thumbnail
-- reaction. Counting both the same is what makes a feed reward bait.

DROP MATERIALIZED VIEW IF EXISTS public.file_engagement_stats;

CREATE MATERIALIZED VIEW public.file_engagement_stats AS
SELECT
  f.id AS file_id,
  COALESCE(lk.cnt, 0::bigint) AS like_count,
  COALESCE(dk.cnt, 0::bigint) AS dislike_count,
  COALESCE(cm.cnt, 0::bigint) AS comment_count,
  COALESCE(ap.deep_action_count, 0::bigint) AS deep_action_count,
  COALESCE(ap.avg_action_ratio, 0)::real     AS avg_action_ratio,
  COALESCE(ap.action_depth_score, 0)::real   AS action_depth_score
FROM files f
LEFT JOIN (
  SELECT likes.file_id, count(*) AS cnt FROM likes GROUP BY likes.file_id
) lk ON lk.file_id = f.id
LEFT JOIN (
  SELECT dislike.file_id, count(*) AS cnt FROM dislike GROUP BY dislike.file_id
) dk ON dk.file_id = f.id
LEFT JOIN (
  SELECT comments.file_id, count(*) AS cnt
  FROM comments
  WHERE comments.is_deleted = false
  GROUP BY comments.file_id
) cm ON cm.file_id = f.id
LEFT JOIN (
  SELECT
    p.file_id,
    count(*) FILTER (WHERE p.action <> 'dislike' AND p.position_ratio >= 0.5) AS deep_action_count,
    avg(p.position_ratio) FILTER (WHERE p.action <> 'dislike')                AS avg_action_ratio,
    -- Depth times reach, so one very deep like cannot outrank sustained
    -- interest, and LN keeps a big channel from swamping the term outright.
    -- Dislikes landing in the first quarter are the bait tell, so they subtract.
    (
      COALESCE(avg(p.position_ratio) FILTER (WHERE p.action <> 'dislike'), 0)
        * ln(1 + count(*) FILTER (WHERE p.action <> 'dislike'))
      - 0.5 * count(*) FILTER (WHERE p.action = 'dislike' AND p.position_ratio < 0.25)
    ) AS action_depth_score
  FROM file_action_positions p
  WHERE p.position_ratio IS NOT NULL
  GROUP BY p.file_id
) ap ON ap.file_id = f.id;

-- Required by REFRESH MATERIALIZED VIEW CONCURRENTLY in
-- refresh_file_engagement_stats(); dropping the view dropped the old one.
CREATE UNIQUE INDEX IF NOT EXISTS file_engagement_stats_file_id_key
  ON public.file_engagement_stats (file_id);
