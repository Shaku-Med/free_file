-- Episodes + episode-item files for a series, with owner + like/dislike for viewer.
-- Security: p_file_series_id must match file_series row owned by p_series_owner_id,
-- and a main file must exist for that series. Each item is filtered like public profile
-- (or full access if viewer is the file owner).
-- Nested episodes: parent_episode_id + depth-first order via sort_path.

DROP FUNCTION IF EXISTS get_series_episodes_with_items_for_viewer(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION get_series_episodes_with_items_for_viewer(
  p_file_series_id  uuid,
  p_series_owner_id uuid,
  p_viewer_id       uuid DEFAULT NULL
)
RETURNS TABLE (
  episode_id          uuid,
  episode_name        text,
  episode_number      numeric,
  parent_episode_id   uuid,
  episode_ord         int,
  id                  uuid,
  created_at          timestamptz,
  endpoint            text,
  filename            text,
  unique_id           text,
  file_size           text,
  file_type           text,
  is_adult            boolean,
  owner_id            uuid,
  is_public           boolean,
  file_description    text,
  file_title          text,
  default_thumbnail   text,
  view_count          numeric,
  share_count         numeric,
  is_reel             boolean,
  duration            numeric,
  categories          jsonb,
  tags                jsonb,
  colors              jsonb,
  metadata            jsonb,
  like_count          bigint,
  dislike_count       bigint,
  comment_count       bigint,
  owner_username      text,
  owner_profile_pic   text,
  owner_verified      boolean,
  owner_about         text,
  user_has_liked      boolean,
  user_has_disliked   boolean,
  upload_status       text
)
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE verified_series AS (
    SELECT fs.id AS series_id
    FROM file_series fs
    WHERE fs.id = p_file_series_id
      AND fs.owner_id = p_series_owner_id
      AND EXISTS (
        SELECT 1
        FROM files fm
        WHERE fm.unique_id = fs.file_id
          AND fm.is_series_main IS TRUE
          AND fm.file_series_id = fs.id
      )
  ),
  ranked AS (
    SELECT
      e.id,
      e.episode_name,
      e.episode_number,
      e.parent_episode_id,
      ROW_NUMBER() OVER (
        PARTITION BY e.parent_episode_id
        ORDER BY e.episode_number NULLS LAST, e.episode_name ASC, e.id
      ) AS srn
    FROM files_series_episodes e
    JOIN verified_series v ON v.series_id = e.feed_series_id
    WHERE e.owner_id = p_series_owner_id
  ),
  episode_order AS (
    SELECT
      r.id,
      r.episode_name,
      r.episode_number,
      r.parent_episode_id,
      LPAD(r.srn::text, 8, '0') AS sort_path
    FROM ranked r
    WHERE r.parent_episode_id IS NULL

    UNION ALL

    SELECT
      r.id,
      r.episode_name,
      r.episode_number,
      r.parent_episode_id,
      eo.sort_path || '.' || LPAD(r.srn::text, 8, '0') AS sort_path
    FROM ranked r
    JOIN episode_order eo ON r.parent_episode_id = eo.id
  )
  SELECT
    ep.id AS episode_id,
    ep.episode_name AS episode_name,
    ep.episode_number AS episode_number,
    ep.parent_episode_id AS parent_episode_id,
    DENSE_RANK() OVER (ORDER BY ep.sort_path)::int AS episode_ord,
    fi.id,
    fi.created_at,
    fi.endpoint,
    fi.filename,
    fi.unique_id,
    fi.file_size,
    fi.file_type,
    fi.is_adult,
    fi.owner_id,
    fi.is_public,
    fi.file_description,
    fi.file_title,
    COALESCE(
      fi.default_thumbnail,
      (SELECT t #>> '{}' FROM unnest(fi.thumbnails) AS t
       WHERE (t #>> '{}') LIKE '%thumbnail_preview.jpg' LIMIT 1)
    ) AS default_thumbnail,
    fi.view_count,
    fi.share_count,
    fi.is_reel,
    fi.duration,
    fi.categories,
    fi.tags,
    fi.colors,
    fi.metadata,
    (SELECT COUNT(*)::bigint FROM likes l WHERE l.file_id = fi.id),
    (SELECT COUNT(*)::bigint FROM dislike d WHERE d.file_id = fi.id),
    (SELECT COUNT(*)::bigint FROM comments c WHERE c.file_id = fi.id AND c.is_deleted = false),
    u.username,
    u.profile_pic,
    u.verified,
    u.about,
    (p_viewer_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM likes l2 WHERE l2.file_id = fi.id AND l2.user_id = p_viewer_id
    )),
    (p_viewer_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM dislike d2 WHERE d2.file_id = fi.id AND d2.user_id = p_viewer_id
    )),
    fi.upload_status
  FROM episode_order ep
  JOIN files_series_episode_items i
    ON i.file_episode_id = ep.id
   AND i.file_series_id = (SELECT series_id FROM verified_series)
   AND i.file_id IS NOT NULL
  JOIN files fi ON fi.unique_id = i.file_id
  JOIN users u ON u.id = fi.owner_id
  WHERE
    COALESCE(fi.is_adult, false) = false
    AND (
      (
        p_viewer_id IS NOT NULL
        AND fi.owner_id = p_viewer_id
      )
      OR (
        fi.is_public = true
        AND (fi.upload_status = 'complete' OR fi.upload_status = 'completed')
      )
    )
  ORDER BY ep.sort_path ASC, fi.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION get_series_episodes_with_items_for_viewer(uuid, uuid, uuid) TO anon, authenticated;
