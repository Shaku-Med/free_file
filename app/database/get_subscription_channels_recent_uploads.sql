-- ============================================================
-- Subscribed channels + recent uploads per channel (YouTube-style strip)
-- Requires: subscriptions, users, files
-- Run after subscription_functions.sql (or any time subscriptions exist)
-- ============================================================

CREATE OR REPLACE FUNCTION get_subscription_channels_recent_uploads(
  p_user_id            uuid,
  p_recent_per_channel int DEFAULT 4,
  p_channels_limit     int DEFAULT 200
)
RETURNS TABLE (
  channel_id       uuid,
  username         text,
  profile_pic      text,
  verified         boolean,
  about            text,
  notify           boolean,
  subscribed_at    timestamptz,
  subscriber_count bigint,
  recent_uploads   jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH subs AS (
    SELECT
      s.channel_id,
      s.notify,
      s.created_at AS subscribed_at
    FROM subscriptions s
    WHERE s.subscriber_id = p_user_id
    ORDER BY s.created_at DESC
    LIMIT p_channels_limit
  ),
  channel_users AS (
    SELECT
      subs.channel_id,
      subs.notify,
      subs.subscribed_at,
      u.username,
      u.profile_pic,
      u.verified,
      u.about
    FROM subs
    JOIN users u ON u.id = subs.channel_id
  ),
  sub_counts AS (
    SELECT s2.channel_id, COUNT(*)::bigint AS cnt
    FROM subscriptions s2
    GROUP BY s2.channel_id
  ),
  ranked_files AS (
    SELECT
      f.owner_id,
      f.id,
      f.unique_id,
      f.file_title,
      f.filename,
      f.thumbnails,
      f.endpoint,
      f.file_type,
      f.created_at,
      f.duration,
      f.is_reel,
      ROW_NUMBER() OVER (
        PARTITION BY f.owner_id
        ORDER BY f.created_at DESC
      ) AS rn
    FROM files f
    JOIN subs ON subs.channel_id = f.owner_id
    WHERE f.is_public = true
      AND f.is_adult = false
      AND (f.upload_status = 'complete' OR f.upload_status = 'completed')
  ),
  top_files AS (
    SELECT *
    FROM ranked_files
    WHERE rn <= GREATEST(1, LEAST(p_recent_per_channel, 20))
  ),
  agg AS (
    SELECT
      tf.owner_id,
      jsonb_agg(
        jsonb_build_object(
          'id', tf.id,
          'unique_id', tf.unique_id,
          'file_title', COALESCE(tf.file_title, ''),
          'filename', tf.filename,
          'thumbnails', tf.thumbnails,
          'endpoint', tf.endpoint,
          'file_type', tf.file_type,
          'created_at', tf.created_at,
          'duration', tf.duration,
          'is_reel', tf.is_reel
        )
        ORDER BY tf.created_at DESC
      ) AS recent_uploads
    FROM top_files tf
    GROUP BY tf.owner_id
  )
  SELECT
    cu.channel_id,
    cu.username,
    cu.profile_pic,
    cu.verified,
    cu.about,
    cu.notify,
    cu.subscribed_at,
    COALESCE(sc.cnt, 0)::bigint,
    COALESCE(a.recent_uploads, '[]'::jsonb)
  FROM channel_users cu
  LEFT JOIN sub_counts sc ON sc.channel_id = cu.channel_id
  LEFT JOIN agg a ON a.owner_id = cu.channel_id
  ORDER BY cu.subscribed_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_subscription_channels_recent_uploads(uuid, int, int) TO authenticated;
