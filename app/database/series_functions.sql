-- ============================================================
-- Series functions — CRUD + episode queries
-- ============================================================
-- Requires: series, files, users tables + add_series migration
-- ============================================================

-- Drop existing overloads cleanly
DO $$
DECLARE
  r  RECORD;
  fns text[] := ARRAY[
    'create_series',
    'get_user_series',
    'get_series_by_id',
    'get_file_series',
    'update_series',
    'delete_series'
  ];
  fn text;
BEGIN
  FOREACH fn IN ARRAY fns LOOP
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
-- 1. create_series
-- ============================================================
CREATE OR REPLACE FUNCTION create_series(
  p_user_id  uuid,
  p_title    text,
  p_desc     text    DEFAULT NULL,
  p_is_public boolean DEFAULT true
)
RETURNS TABLE (
  id            uuid,
  unique_id     text,
  owner_id      uuid,
  title         text,
  description   text,
  thumbnail_url text,
  is_public     boolean,
  created_at    timestamptz,
  updated_at    timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id        uuid := gen_random_uuid();
  v_unique_id text;
  v_count     int;
BEGIN
  -- Enforce per-user limit
  SELECT COUNT(*) INTO v_count FROM series WHERE owner_id = p_user_id;
  IF v_count >= 50 THEN
    RAISE EXCEPTION 'Maximum series limit reached';
  END IF;

  -- Generate unique short id
  LOOP
    v_unique_id := substr(md5(random()::text || clock_timestamp()::text), 1, 16);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM series WHERE unique_id = v_unique_id);
  END LOOP;

  INSERT INTO series (id, unique_id, owner_id, title, description, is_public)
  VALUES (v_id, v_unique_id, p_user_id, p_title, p_desc, p_is_public);

  RETURN QUERY
    SELECT s.id, s.unique_id, s.owner_id, s.title, s.description,
           s.thumbnail_url, s.is_public, s.created_at, s.updated_at
    FROM series s
    WHERE s.id = v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_series TO authenticated;
GRANT EXECUTE ON FUNCTION create_series TO service_role;


-- ============================================================
-- 2. get_user_series — list all series for a user with episode counts
-- ============================================================
CREATE OR REPLACE FUNCTION get_user_series(p_user_id uuid)
RETURNS TABLE (
  id            uuid,
  unique_id     text,
  owner_id      uuid,
  title         text,
  description   text,
  thumbnail_url text,
  is_public     boolean,
  created_at    timestamptz,
  updated_at    timestamptz,
  episode_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.unique_id,
    s.owner_id,
    s.title,
    s.description,
    s.thumbnail_url,
    s.is_public,
    s.created_at,
    s.updated_at,
    COUNT(f.id) AS episode_count
  FROM series s
  LEFT JOIN files f ON f.series_id = s.id
    AND f.upload_status IN ('complete', 'completed')
  WHERE s.owner_id = p_user_id
  GROUP BY s.id
  ORDER BY s.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_user_series TO authenticated;


-- ============================================================
-- 3. get_series_by_id — public-friendly, returns series header + all episodes
-- ============================================================
CREATE OR REPLACE FUNCTION get_series_by_id(
  p_unique_id text,
  p_viewer_id uuid DEFAULT NULL
)
RETURNS TABLE (
  -- Series header (repeated on every row)
  series_id        uuid,
  series_unique_id text,
  series_owner_id  uuid,
  series_title     text,
  series_desc      text,
  series_thumb     text,
  series_is_public boolean,
  series_created   timestamptz,
  -- Episode columns (NULL when series has no episodes yet)
  file_id           uuid,
  file_unique_id    text,
  file_title        text,
  file_description  text,
  file_type         text,
  default_thumbnail text,
  endpoint          text,
  duration          numeric,
  view_count        numeric,
  episode_number    integer,
  season_number     integer,
  file_is_public    boolean,
  file_created_at   timestamptz,
  file_owner_id     uuid,
  owner_username    text,
  owner_avatar_url  text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.unique_id,
    s.owner_id,
    s.title,
    s.description,
    s.thumbnail_url,
    s.is_public,
    s.created_at,
    f.id,
    f.unique_id,
    f.file_title,
    f.file_description,
    f.file_type,
    COALESCE(f.default_thumbnail, (SELECT t #>> '{}' FROM unnest(f.thumbnails) AS t WHERE (t #>> '{}') LIKE '%thumbnail_preview.jpg' LIMIT 1)) AS default_thumbnail,
    f.endpoint,
    f.duration,
    f.view_count,
    f.episode_number,
    f.season_number,
    f.is_public,
    f.created_at,
    f.owner_id,
    u.username,
    u.profile_pic
  FROM series s
  LEFT JOIN files f ON f.series_id = s.id
    AND f.upload_status IN ('complete', 'completed')
    AND (f.is_public = true OR f.owner_id = p_viewer_id)
  LEFT JOIN users u ON u.id = f.owner_id
  WHERE s.unique_id = p_unique_id
    AND (s.is_public = true OR s.owner_id = p_viewer_id)
  ORDER BY
    f.season_number  ASC NULLS LAST,
    f.episode_number ASC NULLS LAST,
    f.created_at     ASC;
$$;

GRANT EXECUTE ON FUNCTION get_series_by_id TO anon, authenticated;


-- ============================================================
-- 4. update_series
-- ============================================================
CREATE OR REPLACE FUNCTION update_series(
  p_series_id    uuid,
  p_user_id      uuid,
  p_title        text    DEFAULT NULL,
  p_desc         text    DEFAULT NULL,
  p_clear_desc   boolean DEFAULT false,
  p_is_public    boolean DEFAULT NULL,
  p_thumbnail_url text   DEFAULT NULL
)
RETURNS TABLE (
  id            uuid,
  unique_id     text,
  owner_id      uuid,
  title         text,
  description   text,
  thumbnail_url text,
  is_public     boolean,
  created_at    timestamptz,
  updated_at    timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM series WHERE id = p_series_id AND owner_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Not found or forbidden';
  END IF;

  UPDATE series
  SET
    title         = COALESCE(p_title,        title),
    description   = CASE
                      WHEN p_clear_desc THEN NULL
                      WHEN p_desc IS NOT NULL THEN p_desc
                      ELSE description
                    END,
    is_public     = COALESCE(p_is_public,    is_public),
    thumbnail_url = COALESCE(p_thumbnail_url, thumbnail_url),
    updated_at    = now()
  WHERE id = p_series_id AND owner_id = p_user_id;

  RETURN QUERY
    SELECT s.id, s.unique_id, s.owner_id, s.title, s.description,
           s.thumbnail_url, s.is_public, s.created_at, s.updated_at
    FROM series s
    WHERE s.id = p_series_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_series TO authenticated;


-- ============================================================
-- 5. delete_series — unlinks files, then removes series
-- ============================================================
CREATE OR REPLACE FUNCTION delete_series(
  p_series_id uuid,
  p_user_id   uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM series WHERE id = p_series_id AND owner_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Not found or forbidden';
  END IF;

  -- Detach all episodes (don't delete the files themselves)
  UPDATE files
  SET series_id = NULL, season_number = NULL, episode_number = NULL
  WHERE series_id = p_series_id;

  DELETE FROM series WHERE id = p_series_id AND owner_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_series TO authenticated;


-- ============================================================
-- 6. get_file_series — used by the dynamic page loader
--    Pass ANY file in the series (main or episode) and get back
--    the full series: header + all episodes the viewer can see,
--    ordered by season then episode number.
-- ============================================================
CREATE OR REPLACE FUNCTION get_file_series(
  p_file_id   uuid,
  p_viewer_id uuid DEFAULT NULL
)
RETURNS TABLE (
  -- Series header (repeated on every row)
  series_id        uuid,
  series_unique_id text,
  series_owner_id  uuid,
  series_title     text,
  series_desc      text,
  series_thumb     text,
  series_is_public boolean,
  series_created   timestamptz,
  -- Episode columns
  file_id           uuid,
  file_unique_id    text,
  file_title        text,
  file_type         text,
  default_thumbnail text,
  endpoint          text,
  duration          numeric,
  view_count        numeric,
  episode_number    integer,
  season_number     integer,
  is_series_main    boolean,
  file_created_at   timestamptz,
  file_owner_id     uuid,
  owner_username    text,
  owner_profile_pic text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.unique_id,
    s.owner_id,
    s.title,
    s.description,
    s.thumbnail_url,
    s.is_public,
    s.created_at,
    f.id,
    f.unique_id,
    f.file_title,
    f.file_type,
    COALESCE(f.default_thumbnail, (SELECT t #>> '{}' FROM unnest(f.thumbnails) AS t WHERE (t #>> '{}') LIKE '%thumbnail_preview.jpg' LIMIT 1)) AS default_thumbnail,
    f.endpoint,
    f.duration,
    f.view_count,
    f.episode_number,
    f.season_number,
    f.is_series_main,
    f.created_at,
    f.owner_id,
    u.username,
    u.profile_pic
  FROM files src                               -- the file we're currently watching
  JOIN series s ON s.id = src.series_id        -- look up its series
  LEFT JOIN files f ON f.series_id = s.id      -- all episodes in that series
    AND (
      f.id = src.id
      OR (
        f.upload_status IN ('complete', 'completed')
        AND (f.is_public = true OR f.owner_id = p_viewer_id)
      )
    )
  LEFT JOIN users u ON u.id = f.owner_id
  WHERE src.id = p_file_id
    AND src.series_id IS NOT NULL
    AND (s.is_public = true OR s.owner_id = p_viewer_id)
  ORDER BY
    f.season_number  ASC NULLS LAST,
    f.episode_number ASC NULLS LAST,
    f.created_at     ASC;
$$;

GRANT EXECUTE ON FUNCTION get_file_series TO anon, authenticated;
