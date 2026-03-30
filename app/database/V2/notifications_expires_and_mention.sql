-- ============================================================
-- Notifications: add expires_at and comment_mention type
-- Run after notifications.sql. Enables cron to delete old rows.
-- ============================================================

-- Add expiration column (e.g. 90 days from created_at; app sets on insert)
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NULL;

-- Allow comment_mention type
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('file_like', 'file_comment', 'comment_reply', 'comment_like', 'comment_mention'));

-- Index for cron: delete expired notifications
CREATE INDEX IF NOT EXISTS idx_notifications_expires_at
  ON public.notifications (expires_at)
  WHERE expires_at IS NOT NULL;

-- ============================================================
-- Cron job (run daily): delete expired notifications
-- Example (Supabase pg_cron or external cron):
--   DELETE FROM public.notifications WHERE expires_at IS NOT NULL AND expires_at < now();
-- ============================================================
