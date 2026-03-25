import { useState, useEffect, useCallback, useRef } from "react";
import { MessageSquare, Loader2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import CommentItem from "./CommentItem";
import CommentForm from "./CommentForm";
import type { CommentGif } from "./CommentForm";
import type { Comment } from "~/lib/Services/CommentService";
interface CommentSectionProps {
  fileId: string;
  currentUserId?: string;
  isReel?: boolean;
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

/** Immutably remove a comment; returns { comments, countDelta } (delta is -1 for one removed). */
function removeCommentFromTree(comments: Comment[], commentId: string): { comments: Comment[]; countDelta: number } {
  const topLevel = comments.findIndex((c) => c.id === commentId);
  if (topLevel >= 0) {
    return {
      comments: comments.filter((_, i) => i !== topLevel),
      countDelta: -1,
    };
  }
  let countDelta = 0;
  const next = comments.map((c) => {
    if (c.replies?.length) {
      const inReplies = c.replies.some((r) => r.id === commentId);
      if (inReplies) {
        countDelta = -1;
        return {
          ...c,
          replies: c.replies!.filter((r) => r.id !== commentId),
          reply_count: Math.max(0, (c.reply_count ?? 0) - 1),
        };
      }
      const { comments: newReplies, countDelta: d } = removeCommentFromTree(c.replies!, commentId);
      countDelta += d;
      return { ...c, replies: newReplies };
    }
    return c;
  });
  return { comments: next, countDelta };
}

const CommentSection = ({
  fileId,
  currentUserId: initialUserId,
  isReel = false,
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

      if (!response.ok) {
        throw new Error("Failed to fetch comments");
      }

      const result = await response.json();
      if (result.success) {
        setComments(Array.isArray(result.data) ? result.data : []);
        setTotalCount(typeof result.totalCount === "number" ? result.totalCount : result.data?.length ?? 0);
        setError(null);
      }
    } catch (err) {
      console.error("Error fetching comments:", err);
      setError("Failed to load comments");
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
    async (content: string, parentId?: string | null, gif?: CommentGif | null) => {
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
          body: JSON.stringify({
            fileId,
            content: content || "",
            parentId: parentId || null,
            gif: gif ? { id: gif.id, url: gif.url, previewUrl: gif.previewUrl } : undefined,
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
    async (parentId: string, content: string, gif?: CommentGif | null) => {
      await handleSubmit(content, parentId, gif);
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
          body: JSON.stringify({ commentId }),
        });

        if (!response.ok) {
          const errBody = await response.json();
          throw new Error(errBody.error || "Failed to delete comment");
        }

        const { comments: next, countDelta } = removeCommentFromTree(comments, commentId);
        setComments(next);
        setTotalCount((n) => Math.max(0, n + countDelta));
      } catch (err) {
        console.error("Error deleting comment:", err);
        setError("Failed to delete comment");
      }
    },
    [currentUserId, comments]
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

      {currentUserId ? (
        <CommentForm
          fileId={fileId}
          onSubmit={(content, gif) => handleSubmit(content, undefined, gif)}
        />
      ) : (
        <div className="bg-muted/50 rounded-lg p-4 text-center">
          <p className="text-sm text-muted-foreground mb-2">
            Please log in to comment
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => (window.location.href = "/auth/login")}
          >
            Login
          </Button>
        </div>
      )}

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
          <p>No comments yet. Be the first to comment!</p>
        </div>
      ) : (
        <div className="space-y-4">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              currentUserId={currentUserId}
              fileId={fileId}
              onReply={handleReply}
              onEdit={handleEdit}
              onDelete={handleDelete}
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

