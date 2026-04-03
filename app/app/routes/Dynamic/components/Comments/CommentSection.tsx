import { useState, useEffect, useCallback, useRef } from "react";
import { MessageSquare, Loader2 } from "lucide-react";
import { Separator } from "~/components/ui/separator";
import CommentItem from "./CommentItem";
import CommentForm from "./CommentForm";
import type { CommentGif, CommentImage } from "./CommentForm";
import type { Comment } from "~/lib/Services/CommentService";
interface CommentSectionProps {
  fileId: string;
  currentUserId?: string;
  fileOwnerId?: string;
  isReel?: boolean;
  commentsEnabled?: boolean;
  /** From `?comment=` — scroll to this comment and emphasize it (e.g. notification deep link). */
  highlightCommentId?: string | null;
}

/** Normalize API comment to full Comment shape (replies, counts, etc.) */
function normalizeComment(raw: Record<string, unknown>): Comment {
  return {
    id: raw.id as string,
    user_id: raw.user_id as string,
    file_id: raw.file_id as string,
    content: (raw.content as string) ?? "",
    parent_id: (raw.parent_id as string | null) ?? null,
    created_at: (raw.created_at as string) ?? new Date().toISOString(),
    updated_at: (raw.updated_at as string) ?? new Date().toISOString(),
    is_edited: Boolean(raw.is_edited),
    is_deleted: Boolean(raw.is_deleted),
    user: raw.user as Comment["user"],
    replies: [],
    reply_count: 0,
    like_count: 0,
    user_has_liked: false,
    gif_id: (raw.gif_id as string | null) ?? null,
    gif_url: (raw.gif_url as string | null) ?? null,
    gif_preview_url: (raw.gif_preview_url as string | null) ?? null,
    image_url: (raw.image_url as string | null) ?? null,
    image_type: (raw.image_type as string | null) ?? null,
    is_hidden: Boolean(raw.is_hidden),
  };
}

/** Immutably add a reply to a parent in the tree. */
function addReplyToTree(comments: Comment[], parentId: string, newReply: Comment): Comment[] {
  return comments.map((c) => {
    if (c.id === parentId) {
      const replies = [...(c.replies ?? []), newReply];
      return { ...c, replies, reply_count: replies.length };
    }
    if (c.replies?.length) {
      return { ...c, replies: addReplyToTree(c.replies, parentId, newReply) };
    }
    return c;
  });
}

/** Immutably update a comment by id. */
function updateCommentInTree(comments: Comment[], commentId: string, updates: Partial<Comment>): Comment[] {
  return comments.map((c) => {
    if (c.id === commentId) return { ...c, ...updates };
    if (c.replies?.length) {
      return { ...c, replies: updateCommentInTree(c.replies, commentId, updates) };
    }
    return c;
  });
}

const CommentSection = ({
  fileId,
  currentUserId: initialUserId,
  fileOwnerId,
  isReel = false,
  commentsEnabled = true,
  highlightCommentId = null,
}: CommentSectionProps) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentUserId] = useState<string | undefined>(initialUserId);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<any>(null);

  const fetchComments = useCallback(async () => {
    try {
      setIsLoading(true);
      const params = new URLSearchParams({
        fileId,
        limit: "50",
        offset: "0",
      });
      if (highlightCommentId) {
        params.set("focusCommentId", highlightCommentId);
      }
      const response = await fetch(`/api/comments?${params.toString()}`, {
        credentials: "include",
      });

      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const msg = result && typeof result === "object" && "error" in result && typeof (result as { error?: string }).error === "string"
          ? (result as { error: string }).error
          : "Failed to fetch comments";
        throw new Error(msg);
      }

      if (result?.success) {
        setComments(Array.isArray(result.data) ? result.data : []);
        setTotalCount(typeof result.totalCount === "number" ? result.totalCount : result.data?.length ?? 0);
        setError(null);
      } else {
        throw new Error(
          result && typeof result === "object" && "error" in result && typeof (result as { error?: string }).error === "string"
            ? (result as { error: string }).error
            : "Failed to load comments"
        );
      }
    } catch (err) {
      console.error("Error fetching comments:", err);
      setError(err instanceof Error ? err.message : "Failed to load comments");
    } finally {
      setIsLoading(false);
    }
  }, [fileId, highlightCommentId]);

  useEffect(() => {
    fetchComments();
    if (typeof window === "undefined") return;
  }, [fileId, fetchComments]);

  useEffect(() => {
    if (!highlightCommentId || isLoading) return;
    const timer = window.setTimeout(() => {
      const el = document.getElementById(`comment-${highlightCommentId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [highlightCommentId, isLoading, comments]);

  const handleSubmit = useCallback(
    async (content: string, parentId?: string | null, gif?: CommentGif | null, image?: CommentImage | null) => {
      if (!currentUserId) {
        window.location.href = "/auth/login";
        return;
      }

      setIsSubmitting(true);
      setError(null);
      try {
        const response = await fetch("/api/comments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            fileId,
            content: content || "",
            parentId: parentId || null,
            gif: gif ? { id: gif.id, url: gif.url, previewUrl: gif.previewUrl } : undefined,
            image: image ? { url: image.url, type: image.type } : undefined,
          }),
        });

        if (!response.ok) {
          if (response.status === 401) {
            window.location.href = "/auth/login";
            return;
          }
          const errBody = await response.json();
          throw new Error(errBody.error || "Failed to post comment");
        }

        const result = await response.json();
        const raw = result.data;
        if (!raw?.id) return;

        const newComment = normalizeComment(raw);
        if (parentId) {
          setComments((prev) => addReplyToTree(prev, parentId, newComment));
        } else {
          setComments((prev) => [newComment, ...prev]);
          setTotalCount((n) => n + 1);
        }
      } catch (err) {
        console.error("Error submitting comment:", err);
        setError("Failed to post comment");
      } finally {
        setIsSubmitting(false);
      }
    },
    [fileId, currentUserId]
  );

  const handleReply = useCallback(
    async (parentId: string, content: string, gif?: CommentGif | null, image?: CommentImage | null) => {
      await handleSubmit(content, parentId, gif, image);
    },
    [handleSubmit]
  );

  const handleLike = useCallback(async (commentId: string) => {
    try {
      const response = await fetch("/api/comment-likes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commentId }),
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to like");
      }
      // No refetch – CommentItem keeps optimistic like count / state
    } catch (err) {
      console.error("Error liking comment:", err);
    }
  }, []);

  const handleEdit = useCallback(
    async (commentId: string, content: string) => {
      if (!currentUserId) return;

      setError(null);
      try {
        const response = await fetch("/api/comments", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commentId, content }),
        });

        if (!response.ok) {
          const errBody = await response.json();
          throw new Error(errBody.error || "Failed to update comment");
        }

        const result = await response.json();
        const raw = result.data;
        if (raw?.id) {
          setComments((prev) =>
            updateCommentInTree(prev, commentId, {
              content: (raw.content as string) ?? content,
              is_edited: true,
              updated_at: (raw.updated_at as string) ?? new Date().toISOString(),
            })
          );
        }
      } catch (err) {
        console.error("Error updating comment:", err);
        setError("Failed to update comment");
      }
    },
    [currentUserId]
  );

  const handleDelete = useCallback(
    async (commentId: string) => {
      if (!currentUserId) return;

      setError(null);
      try {
        const response = await fetch("/api/comments", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ commentId }),
        });

        if (!response.ok) {
          const errBody = await response.json();
          throw new Error(errBody.error || "Failed to delete comment");
        }

        // Server cascades soft-delete to all nested replies — refetch to stay in sync
        await fetchComments();
      } catch (err) {
        console.error("Error deleting comment:", err);
        setError("Failed to delete comment");
      }
    },
    [currentUserId, fetchComments]
  );

  const handleHide = useCallback(
    async (commentId: string, hidden: boolean) => {
      if (!currentUserId) return;
      setError(null);
      try {
        const response = await fetch("/api/comments", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ commentId, hidden }),
        });
        if (!response.ok) {
          const errBody = await response.json();
          throw new Error(errBody.error || "Failed to hide comment");
        }
        setComments((prev) =>
          updateCommentInTree(prev, commentId, { is_hidden: hidden })
        );
      } catch (err) {
        console.error("Error hiding comment:", err);
        setError("Failed to hide comment");
      }
    },
    [currentUserId]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-foreground" />
          <h2 className="text-lg font-semibold text-foreground">
            Comments ({totalCount})
          </h2>
        </div>
        {highlightCommentId && !isLoading && (
          <p className="text-xs text-muted-foreground sm:text-right">
            Highlighting the comment from your notification.
          </p>
        )}
      </div>

      <Separator />

      {!commentsEnabled && currentUserId && (
        <div className="bg-muted/40 rounded-lg border border-border/50 px-3 py-2.5 text-center">
          <p className="text-sm text-muted-foreground">
            New comments and replies are disabled. Existing comments stay visible below.
          </p>
        </div>
      )}

      {commentsEnabled && currentUserId ? (
        <CommentForm
          fileId={fileId}
          onSubmit={(content, gif, image) => handleSubmit(content, undefined, gif, image)}
        />
      ) : null}

      {error && (
        <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (comments.length === 0 || totalCount === 0) ? (
        <div className="text-center py-8 text-muted-foreground">
          <MessageSquare className="h-12 w-12 mx-auto mb-2 opacity-50" />
          <p>
            {!currentUserId || !commentsEnabled
              ? "No comments on this upload yet."
              : "No comments yet. Be the first to comment!"}
          </p>
        </div>
      ) : (
        <div className="space-y-4 min-w-0 max-w-full overflow-x-auto overscroll-x-contain [scrollbar-gutter:stable]">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              currentUserId={currentUserId}
              fileOwnerId={fileOwnerId}
              fileId={fileId}
              allowNewComments={Boolean(commentsEnabled && currentUserId)}
              onReply={handleReply}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onHide={handleHide}
              onLike={handleLike}
              highlightCommentId={highlightCommentId}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default CommentSection;

