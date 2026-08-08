-- SoundCloud-style comment markers: where in the video a comment was written.
--
-- NULL is the normal case and means "no position", not zero. A comment left
-- from a feed card, a profile, or before playback started has no playhead to
-- record, and rendering all of those at 0:00 would pile them on the left edge
-- of the slider.
--
-- Top-level comments only. Replies belong to their thread rather than to a
-- moment, and marking them would crowd the bar; the API enforces that.

ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS timestamp_seconds integer;

ALTER TABLE public.comments
  DROP CONSTRAINT IF EXISTS comments_timestamp_seconds_nonneg;
ALTER TABLE public.comments
  ADD CONSTRAINT comments_timestamp_seconds_nonneg
  CHECK (timestamp_seconds IS NULL OR timestamp_seconds >= 0);

-- Partial: the marker query only ever wants the commented moments for one file,
-- and the vast majority of rows will have no timestamp at all.
CREATE INDEX IF NOT EXISTS comments_file_timestamp_idx
  ON public.comments (file_id, timestamp_seconds)
  WHERE timestamp_seconds IS NOT NULL AND is_deleted = false;
