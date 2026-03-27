-- Image-only comments failed checks that only allowed text or GIF columns.
-- Replace with a constraint that treats non-empty image_url like GIF payload.

ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS comments_content_or_gif;

ALTER TABLE public.comments
  ADD CONSTRAINT comments_content_media_or_text CHECK (
    (content IS NOT NULL AND btrim(content) <> '')
    OR (gif_id IS NOT NULL AND gif_url IS NOT NULL)
    OR (image_url IS NOT NULL AND btrim(image_url) <> '')
  );
