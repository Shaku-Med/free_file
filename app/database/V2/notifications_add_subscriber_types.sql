-- Allow new_subscriber (and channel_upload for future use) on existing DBs.
-- Run once if notifications_type_check still lists only the five comment/like types.

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
    'channel_upload'
  ));
