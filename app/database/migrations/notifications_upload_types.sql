-- Upload outcome notifications: tell the uploader their file finished
-- processing, or that it failed.
--
-- These are system notifications, not social ones, so actor_id is the owner
-- themselves. actor_id is NOT NULL with a foreign key to users, so it has to
-- be somebody, and the recipient is the honest choice.
--
-- Run once. Safe to re-run.

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'file_like',
    'file_comment',
    'comment_reply',
    'comment_like',
    'comment_mention',
    'new_subscriber',
    'channel_upload',
    'upload_ready',
    'upload_failed'
  ));

-- The worker retries the completion webhook, so the fan-out must only ever
-- notify once per file. Checking in application code first would still race
-- two concurrent retries, so the uniqueness is enforced here and the insert
-- itself is the claim: whoever inserts sends, the loser stops.
--
-- Partial on purpose. A plain unique index over (user_id, file_id, type) would
-- break the social types, where two different people liking the same file
-- legitimately produce two rows that differ only by actor_id.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_upload_ready_once_idx
  ON public.notifications (user_id, file_id, type)
  WHERE type = 'upload_ready';

-- upload_failed is not covered above: that path deletes the files row, so
-- file_id is NULL and NULLs never collide in a unique index. It is deduped
-- exactly instead by the delete reporting whether it actually removed a row.
