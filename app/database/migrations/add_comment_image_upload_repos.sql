-- Staging table: GoUpload notifies the app with (storage_path, github_repo) right after pushing a comment image.
-- When the user creates the comment (image_url = path), CommentService copies repo onto comments.image_github_repo and deletes the row.
CREATE TABLE IF NOT EXISTS public.comment_image_upload_repos (
  storage_path text NOT NULL PRIMARY KEY,
  github_repo text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.comment_image_upload_repos IS
  'Temporary map from comment image GitHub path to repo name (from Go upload). Consumed when comment row is inserted.';
