-- ============================================================
-- Comment likes (reactions) + GIF comments
-- ============================================================
-- 1. comment_likes: one row per user-like on a comment.
-- 2. comments: add optional GIF fields; allow content to be empty when gif is set.
-- 3. Root comments ordered by (like_count DESC, reply_count DESC, created_at DESC) in app.
-- Run after comments.sql and comments_functions.sql.
-- ============================================================

-- Comment likes (like Instagram: one "like" per user per comment)
CREATE TABLE IF NOT EXISTS public.comment_likes (
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  comment_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comment_likes_pkey PRIMARY KEY (id),
  CONSTRAINT comment_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE,
  CONSTRAINT comment_likes_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.comments (id) ON DELETE CASCADE,
  CONSTRAINT comment_likes_user_comment_unique UNIQUE (user_id, comment_id)
);

CREATE INDEX IF NOT EXISTS idx_comment_likes_comment ON public.comment_likes (comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_likes_user ON public.comment_likes (user_id);

-- Allow GIF-only comments: add nullable GIF columns to comments
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS gif_id text,
  ADD COLUMN IF NOT EXISTS gif_url text,
  ADD COLUMN IF NOT EXISTS gif_preview_url text;

-- Drop old content length check if it exists (so we can allow empty content when gif is set)
ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS comments_content_length;

-- Comment must have either non-empty text or a GIF
ALTER TABLE public.comments
  ADD CONSTRAINT comments_content_or_gif CHECK (
    (trim(coalesce(content, '')) <> '' AND char_length(trim(content)) <= 2000)
    OR (gif_id IS NOT NULL AND trim(coalesce(gif_id, '')) <> '')
  );

-- Optional: index for ordering roots by file (already have idx_comments_file_created)
-- Like counts are computed in app or via a view; no new index required.

GRANT SELECT, INSERT, DELETE ON public.comment_likes TO authenticated;
GRANT SELECT ON public.comment_likes TO anon;
