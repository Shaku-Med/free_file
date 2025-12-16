import { useState, useEffect, useCallback, useRef } from "react";
import { MessageSquare, Loader2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import CommentItem from "./CommentItem";
import CommentForm from "./CommentForm";
import type { Comment } from "~/lib/Services/CommentService";
import { createClient } from "@supabase/supabase-js";

interface CommentSectionProps {
  fileId: string;
  currentUserId?: string;
}

const CommentSection = ({ fileId, currentUserId: initialUserId }: CommentSectionProps) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentUserId] = useState<string | undefined>(initialUserId);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<any>(null);

  const fetchComments = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/comments?fileId=${fileId}&limit=50&offset=0`);
      
      if (!response.ok) {
        throw new Error("Failed to fetch comments");
      }

      const result = await response.json();
      if (result.success && result.data) {
        setComments(result.data);
        setError(null);
      }
    } catch (err) {
      console.error("Error fetching comments:", err);
      setError("Failed to load comments");
    } finally {
      setIsLoading(false);
    }
  }, [fileId]);

  useEffect(() => {
    fetchComments();

    if (typeof window === "undefined") return;

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

    if (!supabaseUrl || !supabaseKey) {
      return;
    }

    const supabaseClient = createClient(supabaseUrl, supabaseKey);

    const channel = supabaseClient
      .channel(`comments:${fileId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'comments',
          filter: `file_id=eq.${fileId}`,
        },
        (payload: any) => {
          if (payload.eventType === 'INSERT') {
            fetchComments();
          } else if (payload.eventType === 'UPDATE') {
            setComments((prev) =>
              prev.map((comment) => {
                if (comment.id === payload.new.id) {
                  return { ...comment, ...payload.new };
                }
                if (comment.replies) {
                  const updatedReplies = comment.replies.map((reply: Comment) =>
                    reply.id === payload.new.id ? { ...reply, ...payload.new } : reply
                  );
                  return { ...comment, replies: updatedReplies };
                }
                return comment;
              })
            );
          } else if (payload.eventType === 'DELETE') {
            setComments((prev) =>
              prev.filter((comment) => comment.id !== payload.old.id)
            );
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current && supabaseClient) {
        supabaseClient.removeChannel(channelRef.current);
      }
    };
  }, [fileId, fetchComments]);

  const handleSubmit = useCallback(
    async (content: string, parentId?: string | null) => {
      if (!currentUserId) {
        window.location.href = "/auth/login";
        return;
      }

      setIsSubmitting(true);
      try {
        const response = await fetch("/api/comments", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileId,
            content,
            parentId: parentId || null,
          }),
        });

        if (!response.ok) {
          if (response.status === 401) {
            window.location.href = "/auth/login";
            return;
          }
          const error = await response.json();
          throw new Error(error.error || "Failed to post comment");
        }

        await fetchComments();
      } catch (err) {
        console.error("Error submitting comment:", err);
        setError("Failed to post comment");
      } finally {
        setIsSubmitting(false);
      }
    },
    [fileId, currentUserId, fetchComments]
  );

  const handleReply = useCallback(
    async (parentId: string, content: string) => {
      await handleSubmit(content, parentId);
    },
    [handleSubmit]
  );

  const handleEdit = useCallback(
    async (commentId: string, content: string) => {
      if (!currentUserId) return;

      try {
        const response = await fetch("/api/comments", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            commentId,
            content,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to update comment");
        }

        await fetchComments();
      } catch (err) {
        console.error("Error updating comment:", err);
        setError("Failed to update comment");
      }
    },
    [currentUserId, fetchComments]
  );

  const handleDelete = useCallback(
    async (commentId: string) => {
      if (!currentUserId) return;

      try {
        const response = await fetch("/api/comments", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            commentId,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to delete comment");
        }

        await fetchComments();
      } catch (err) {
        console.error("Error deleting comment:", err);
        setError("Failed to delete comment");
      }
    },
    [currentUserId, fetchComments]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-foreground" />
        <h2 className="text-lg font-semibold text-foreground">
          Comments ({comments.length})
        </h2>
      </div>

      <Separator />

      {currentUserId ? (
        <CommentForm
          fileId={fileId}
          onSubmit={(content) => handleSubmit(content)}
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
      ) : comments.length === 0 ? (
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
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default CommentSection;

