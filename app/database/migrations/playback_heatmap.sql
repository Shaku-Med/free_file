-- Most-replayed data: where in a video people actually spend their time.
--
-- Stored as a fixed number of buckets per file rather than raw timestamps, so a
-- 30 second clip and a 3 hour one both cost the same and the graph has the same
-- resolution either way. Bucket i covers [i/N, (i+1)/N) of the duration.
--
-- Only aggregate counters live here. There is no per-viewer row: nothing in this
-- table can say who watched what, which keeps a rewind history from becoming a
-- surveillance record, and keeps the table small enough to sum cheaply.

CREATE TABLE IF NOT EXISTS public.file_playback_heat (
  file_id  uuid    NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  bucket   smallint NOT NULL CHECK (bucket >= 0 AND bucket < 100),
  samples  bigint  NOT NULL DEFAULT 0,
  PRIMARY KEY (file_id, bucket)
);

-- The only read pattern is "give me every bucket for one file", which the
-- primary key already serves. No extra index.

-- Server-side only, through the SECURITY DEFINER function below.
ALTER TABLE public.file_playback_heat ENABLE ROW LEVEL SECURITY;

-- How many buckets a file is divided into. Changing this invalidates existing
-- rows, so treat it as fixed once data exists.
CREATE OR REPLACE FUNCTION public.playback_heat_buckets()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 100 $$;

-- p_buckets is a flat array of [bucket, count, bucket, count, ...].
--
-- Every value is treated as hostile. The caller is a browser reporting on its
-- own playback, so the counts are clamped per bucket and the total is clamped
-- for the whole call: the honest client sends at most one sample per 500ms
-- between heartbeats, so a report claiming hundreds of samples per bucket is
-- either broken or lying. Clamping rather than rejecting keeps a slow tab from
-- silently losing its data.
CREATE OR REPLACE FUNCTION public.record_playback_heat(
  p_file_id uuid,
  p_buckets integer[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n           integer := playback_heat_buckets();
  v_max_per     integer := 120;   -- ~60s in one bucket at 2 samples/sec
  v_max_total   integer := 240;   -- one heartbeat cannot cover more than this
  v_running     integer := 0;
  i             integer;
  v_bucket      integer;
  v_count       integer;
BEGIN
  IF p_file_id IS NULL OR p_buckets IS NULL OR array_length(p_buckets, 1) IS NULL THEN
    RETURN;
  END IF;
  -- Flat pairs only.
  IF array_length(p_buckets, 1) % 2 <> 0 THEN
    RETURN;
  END IF;
  -- A report can never touch more buckets than the file has.
  IF array_length(p_buckets, 1) / 2 > v_n THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM files WHERE id = p_file_id) THEN
    RETURN;
  END IF;

  i := 1;
  WHILE i < array_length(p_buckets, 1) LOOP
    v_bucket := p_buckets[i];
    v_count  := p_buckets[i + 1];
    i := i + 2;

    CONTINUE WHEN v_bucket IS NULL OR v_count IS NULL;
    CONTINUE WHEN v_bucket < 0 OR v_bucket >= v_n;
    CONTINUE WHEN v_count <= 0;

    v_count := LEAST(v_count, v_max_per);
    IF v_running + v_count > v_max_total THEN
      v_count := v_max_total - v_running;
    END IF;
    EXIT WHEN v_count <= 0;
    v_running := v_running + v_count;

    INSERT INTO file_playback_heat (file_id, bucket, samples)
    VALUES (p_file_id, v_bucket::smallint, v_count)
    ON CONFLICT (file_id, bucket)
    DO UPDATE SET samples = file_playback_heat.samples + EXCLUDED.samples;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.record_playback_heat(uuid, integer[]) FROM public;
GRANT EXECUTE ON FUNCTION public.record_playback_heat(uuid, integer[]) TO anon, authenticated;

-- Read side for the player and studio later. Returns the curve normalised 0..1
-- against the file's own peak, which is what a heat bar wants, plus the raw
-- samples for studio analytics.
--
-- Held back below a minimum total so a video watched twice does not render a
-- confident looking graph built from one person's rewind.
CREATE OR REPLACE FUNCTION public.get_playback_heat(p_file_id uuid)
RETURNS TABLE (bucket smallint, samples bigint, intensity real)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH raw AS (
    SELECT h.bucket, h.samples
    FROM file_playback_heat h
    WHERE h.file_id = p_file_id
  ),
  totals AS (
    SELECT COALESCE(SUM(samples), 0) AS total, COALESCE(MAX(samples), 0) AS peak FROM raw
  )
  SELECT r.bucket,
         r.samples,
         CASE WHEN t.peak > 0 THEN (r.samples::real / t.peak::real) ELSE 0 END AS intensity
  FROM raw r, totals t
  WHERE t.total >= 300
  ORDER BY r.bucket;
$$;

REVOKE ALL ON FUNCTION public.get_playback_heat(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_playback_heat(uuid) TO anon, authenticated;
