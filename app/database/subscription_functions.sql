-- ============================================================
-- Subscription functions — subscribe, unsubscribe, counts, feeds
-- ============================================================
-- Requires: subscriptions, users, files tables
-- Run after subscriptions.sql
-- ============================================================

-- Drop existing overloads
DO $$
DECLARE
  r RECORD;
  fns text[] := ARRAY[
    'subscribe',
    'unsubscribe',
    'toggle_subscription',
    'is_subscribed',
    'get_subscriber_count',
    'get_subscription_count',
    'get_subscribers',
    'get_subscriptions',
    'get_subscription_feed',
    'toggle_subscription_notify',
    'get_channel_stats'
  ];
  fn text;
BEGIN
  FOREACH fn IN ARRAY fns
  LOOP
    FOR r IN
      SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn
    LOOP
      EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE', r.nspname, r.proname, r.args);
    END LOOP;
  END LOOP;
END $$;


-- ============================================================
-- 1. subscribe — follow a channel
-- ============================================================
CREATE OR REPLACE FUNCTION subscribe(
  p_subscriber_id uuid,
  p_channel_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub_id uuid;
BEGIN
  IF p_subscriber_id IS NULL OR p_channel_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing user IDs');
  END IF;

  IF p_subscriber_id = p_channel_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot subscribe to yourself');
  END IF;

  -- Check channel exists
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_channel_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Channel not found');
  END IF;

  INSERT INTO subscriptions (subscriber_id, channel_id)
  VALUES (p_subscriber_id, p_channel_id)
  ON CONFLICT (subscriber_id, channel_id) DO NOTHING
  RETURNING id INTO v_sub_id;

  IF v_sub_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'already_subscribed', true);
  END IF;

  RETURN jsonb_build_object('success', true, 'subscription_id', v_sub_id);
END;
$$;


-- ============================================================
-- 2. unsubscribe — unfollow a channel
-- ============================================================
CREATE OR REPLACE FUNCTION unsubscribe(
  p_subscriber_id uuid,
  p_channel_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int;
BEGIN
  IF p_subscriber_id IS NULL OR p_channel_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing user IDs');
  END IF;

  DELETE FROM subscriptions
  WHERE subscriber_id = p_subscriber_id AND channel_id = p_channel_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'was_subscribed', v_deleted > 0);
END;
$$;


-- ============================================================
-- 3. toggle_subscription — subscribe if not, unsubscribe if yes
-- ============================================================
CREATE OR REPLACE FUNCTION toggle_subscription(
  p_subscriber_id uuid,
  p_channel_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists boolean;
  v_count bigint;
BEGIN
  IF p_subscriber_id IS NULL OR p_channel_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing user IDs');
  END IF;

  IF p_subscriber_id = p_channel_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot subscribe to yourself');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM subscriptions
    WHERE subscriber_id = p_subscriber_id AND channel_id = p_channel_id
  ) INTO v_exists;

  IF v_exists THEN
    DELETE FROM subscriptions
    WHERE subscriber_id = p_subscriber_id AND channel_id = p_channel_id;
  ELSE
    INSERT INTO subscriptions (subscriber_id, channel_id)
    VALUES (p_subscriber_id, p_channel_id)
    ON CONFLICT DO NOTHING;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM subscriptions WHERE channel_id = p_channel_id;

  RETURN jsonb_build_object(
    'success', true,
    'subscribed', NOT v_exists,
    'subscriber_count', v_count
  );
END;
$$;


-- ============================================================
-- 4. is_subscribed — check if user follows a channel
-- ============================================================
CREATE OR REPLACE FUNCTION is_subscribed(
  p_subscriber_id uuid,
  p_channel_id    uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM subscriptions
    WHERE subscriber_id = p_subscriber_id
      AND channel_id = p_channel_id
  );
$$;


-- ============================================================
-- 5. get_subscriber_count — how many subscribers a channel has
-- ============================================================
CREATE OR REPLACE FUNCTION get_subscriber_count(p_channel_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::bigint FROM subscriptions WHERE channel_id = p_channel_id;
$$;


-- ============================================================
-- 6. get_subscription_count — how many channels a user follows
-- ============================================================
CREATE OR REPLACE FUNCTION get_subscription_count(p_user_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::bigint FROM subscriptions WHERE subscriber_id = p_user_id;
$$;


-- ============================================================
-- 7. get_subscribers — list of people subscribed to a channel
-- ============================================================
CREATE OR REPLACE FUNCTION get_subscribers(
  p_channel_id  uuid,
  p_limit       int DEFAULT 20,
  p_cursor_pos  int DEFAULT 0
)
RETURNS TABLE (
  user_id      uuid,
  username     text,
  profile_pic  text,
  verified     boolean,
  about        text,
  subscribed_at timestamptz,
  row_num      bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id,
    u.username,
    u.profile_pic,
    u.verified,
    u.about,
    s.created_at,
    ROW_NUMBER() OVER (ORDER BY s.created_at DESC) AS row_num
  FROM subscriptions s
  JOIN users u ON u.id = s.subscriber_id
  WHERE s.channel_id = p_channel_id
  ORDER BY s.created_at DESC
  OFFSET p_cursor_pos
  LIMIT p_limit;
$$;


-- ============================================================
-- 8. get_subscriptions — channels a user is subscribed to
-- ============================================================
CREATE OR REPLACE FUNCTION get_subscriptions(
  p_user_id     uuid,
  p_limit       int DEFAULT 50,
  p_cursor_pos  int DEFAULT 0
)
RETURNS TABLE (
  channel_id   uuid,
  username     text,
  profile_pic  text,
  verified     boolean,
  about        text,
  notify       boolean,
  subscribed_at timestamptz,
  subscriber_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id,
    u.username,
    u.profile_pic,
    u.verified,
    u.about,
    s.notify,
    s.created_at,
    COALESCE(sc.cnt, 0)::bigint
  FROM subscriptions s
  JOIN users u ON u.id = s.channel_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::bigint AS cnt
    FROM subscriptions s2
    WHERE s2.channel_id = s.channel_id
  ) sc ON true
  WHERE s.subscriber_id = p_user_id
  ORDER BY s.created_at DESC
  OFFSET p_cursor_pos
  LIMIT p_limit;
$$;


-- ============================================================
-- 9. get_subscription_feed — latest uploads from subscribed channels
--    Mirrors the get_feed return type for consistency
-- ============================================================
CREATE OR REPLACE FUNCTION get_subscription_feed(
  p_user_id     uuid,
  p_limit       int DEFAULT 20,
  p_cursor_pos  int DEFAULT 0
)
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
  thumbnails       jsonb[],
  view_count       numeric,
  share_count      numeric,
  is_reel          boolean,
  duration         numeric,
  categories       jsonb,
  tags             jsonb,
  colors           jsonb,
  metadata         jsonb,
  like_count       bigint,
  dislike_count    bigint,
  comment_count    bigint,
  engagement_score float,
  feed_pool        text,
  owner_username    text,
  owner_profile_pic text,
  owner_verified    boolean,
  owner_about       text,
  user_has_liked    boolean,
  user_has_disliked boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;  -- no results for anonymous
  END IF;

  RETURN QUERY
  WITH
  user_likes AS (
    SELECT l.file_id FROM likes l WHERE l.user_id = p_user_id
  ),
  user_dislikes AS (
    SELECT d.file_id FROM dislike d WHERE d.user_id = p_user_id
  ),
  sub_channels AS (
    SELECT s.channel_id FROM subscriptions s WHERE s.subscriber_id = p_user_id
  ),
  ranked AS (
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
      f.thumbnails,
      f.view_count,
      f.share_count,
      f.is_reel,
      f.duration,
      f.categories,
      f.tags,
      f.colors,
      f.metadata,
      (SELECT COUNT(*)::bigint FROM likes l WHERE l.file_id = f.id) AS _like_count,
      (SELECT COUNT(*)::bigint FROM dislike d WHERE d.file_id = f.id) AS _dislike_count,
      (SELECT COUNT(*)::bigint FROM comments c WHERE c.file_id = f.id AND c.is_deleted = false) AS _comment_count,
      (ul.file_id IS NOT NULL)      AS _user_liked,
      (ud.file_id IS NOT NULL)      AS _user_disliked,
      ROW_NUMBER() OVER (ORDER BY f.created_at DESC) AS _rn
    FROM files f
    JOIN sub_channels sc ON sc.channel_id = f.owner_id
    LEFT JOIN user_likes ul ON ul.file_id = f.id
    LEFT JOIN user_dislikes ud ON ud.file_id = f.id
    WHERE f.is_public = true
      AND f.is_adult = false           -- HARD BLOCK: never show adult content in feeds
      AND (f.upload_status = 'complete' OR f.upload_status = 'completed')
  )

  SELECT
    r.id,
    r.created_at,
    r.endpoint,
    r.filename,
    r.unique_id,
    r.file_size,
    r.file_type,
    r.is_adult,
    r.owner_id,
    r.is_public,
    r.file_description,
    r.file_title,
    r.thumbnails,
    r.view_count,
    r.share_count,
    r.is_reel,
    r.duration,
    r.categories,
    r.tags,
    r.colors,
    r.metadata,
    r._like_count,
    r._dislike_count,
    r._comment_count,
    0.0::float AS engagement_score,
    'subscription'::text AS feed_pool,
    u.username,
    u.profile_pic,
    u.verified,
    u.about,
    r._user_liked,
    r._user_disliked
  FROM ranked r
  JOIN users u ON u.id = r.owner_id
  WHERE r._rn > p_cursor_pos
  ORDER BY r._rn ASC
  LIMIT p_limit;
END;
$$;


-- ============================================================
-- 10. toggle_subscription_notify — toggle notification bell
-- ============================================================
CREATE OR REPLACE FUNCTION toggle_subscription_notify(
  p_subscriber_id uuid,
  p_channel_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notify boolean;
BEGIN
  UPDATE subscriptions
  SET notify = NOT notify
  WHERE subscriber_id = p_subscriber_id AND channel_id = p_channel_id
  RETURNING notify INTO v_notify;

  IF v_notify IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not subscribed');
  END IF;

  RETURN jsonb_build_object('success', true, 'notify', v_notify);
END;
$$;


-- ============================================================
-- 11. get_channel_stats — subscriber count + subscription count for a user
-- ============================================================
CREATE OR REPLACE FUNCTION get_channel_stats(
  p_user_id    uuid,
  p_viewer_id  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subscriber_count bigint;
  v_subscription_count bigint;
  v_is_subscribed boolean := false;
  v_notify boolean := true;
BEGIN
  SELECT COUNT(*) INTO v_subscriber_count
  FROM subscriptions WHERE channel_id = p_user_id;

  SELECT COUNT(*) INTO v_subscription_count
  FROM subscriptions WHERE subscriber_id = p_user_id;

  IF p_viewer_id IS NOT NULL AND p_viewer_id != p_user_id THEN
    SELECT notify INTO v_notify
    FROM subscriptions
    WHERE subscriber_id = p_viewer_id AND channel_id = p_user_id;

    v_is_subscribed := FOUND;
    IF NOT FOUND THEN v_notify := true; END IF;
  END IF;

  RETURN jsonb_build_object(
    'subscriber_count', v_subscriber_count,
    'subscription_count', v_subscription_count,
    'is_subscribed', v_is_subscribed,
    'notify', v_notify
  );
END;
$$;


-- ============================================================
-- Grants
-- ============================================================
GRANT EXECUTE ON FUNCTION subscribe(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION unsubscribe(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION toggle_subscription(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION is_subscribed(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_subscriber_count(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_subscription_count(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_subscribers(uuid, int, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_subscriptions(uuid, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION get_subscription_feed(uuid, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION toggle_subscription_notify(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_channel_stats(uuid, uuid) TO anon, authenticated;

-- Optional: run get_subscription_channels_recent_uploads.sql for the Subscriptions page
-- (channels + recent uploads per channel for the YouTube-style UI).
