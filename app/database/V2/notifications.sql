-- ============================================================
-- Notifications: file like, file comment, comment reply, comment like
-- ============================================================
-- Run after comments, comment_likes, likes, files exist.
-- App creates rows when: file liked, comment on file, reply to comment, comment liked.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  type        text NOT NULL,
  actor_id    uuid NOT NULL,
  file_id     uuid NULL,
  comment_id  uuid NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz NULL,
  expires_at  timestamptz NULL,
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE,
  CONSTRAINT notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users (id) ON DELETE CASCADE,
  CONSTRAINT notifications_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.files (id) ON DELETE SET NULL,
  CONSTRAINT notifications_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.comments (id) ON DELETE SET NULL,
  CONSTRAINT notifications_type_check CHECK (type IN ('file_like', 'file_comment', 'comment_reply', 'comment_like', 'comment_mention'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON public.notifications (user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_expires_at ON public.notifications (expires_at) WHERE expires_at IS NOT NULL;

-- Cron: DELETE FROM public.notifications WHERE expires_at IS NOT NULL AND expires_at < now();
GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;
GRANT SELECT ON public.notifications TO anon;
