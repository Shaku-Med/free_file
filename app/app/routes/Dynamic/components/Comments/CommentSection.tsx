import { useState, useEffect, useCallback, useRef } from "react";
import { MessageSquare, Loader2 } from "lucide-react";
import CommentItem from "./CommentItem";
import CommentForm from "./CommentForm";
import type { CommentGif, CommentImage, CommentImageUploadContext } from "./CommentForm";
import type { Comment } from "~/lib/Services/CommentService";
import { arrangeDateForThumbnail, cn } from "~/lib/utils";
import { buildLoginHref } from "~/lib/loginRedirect";
import { useSidebarOptional } from "~/components/ui/sidebar";

function goToLogin() {
  window.location.href = buildLoginHref(
    window.location.pathname + window.location.search,
  );
}
import { CommentSignInDialog } from "./CommentSignInDialog";
import { Button } from "~/components/ui/button";

const COMMENTS_PAGE_SIZE = 50;

function readAppBottomNavHeightPx(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--app-bottom-nav-h").trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function getPageScrollRoot(): HTMLElement | null {
  return document.getElementById("scroll_container");
}

/**
 * Session cache of loaded comments keyed by fileId. The watch page renders
 * CommentSection in different containers per breakpoint (inline vs. drawer),
 * so crossing a breakpoint REMOUNTS this component  without a cache that
 * meant a fresh spinner + network fetch every resize. Seeding from here keeps
 * remounts instant and request-free; local edits keep it in sync.
 */
const commentCache = new Map<string, { comments: Comment[]; totalCount: number }>();
const COMMENT_CACHE_MAX = 20;

function writeCommentCache(fileId: string, comments: Comment[], totalCount: number) {
  if (commentCache.has(fileId)) commentCache.delete(fileId); // bump LRU order
  commentCache.set(fileId, { comments, totalCount });
  if (commentCache.size > COMMENT_CACHE_MAX) {
    const oldest = commentCache.keys().next().value;
    if (oldest !== undefined) commentCache.delete(oldest);
  }
}
interface CommentSectionProps {
  fileId: string;
  /** Parent video unique_id — required for GoUpload folder placement. */
  fileUniqueId?: string | null;
  /** Parent video created_at — builds the GitHub/R2 date folder. */
  fileCreatedAt?: string | null;
  fileIsAdult?: boolean | null;
  currentUserId?: string;
  fileOwnerId?: string;
  isReel?: boolean;
  commentsEnabled?: boolean;
  /** From `?comment=`  scroll to this comment and emphasize it (e.g. notification deep link). */
  highlightCommentId?: string | null;
  /** e.g. `min-h-0` when inside a flex / scroll parent */
  className?: string;
  /**
   * Use in drawer/dialog: thread list grows in the remaining height and scrolls internally;
   * composer stays fixed at the bottom of the panel.
   */
  fillHeight?: boolean;
  /**
   * Video duration in seconds  enables timestamp linkification in
   * comment bodies (M:SS / H:MM:SS spans become clickable seek buttons).
   * Omit on non-video pages.
   */
  fileDurationSec?: number;
  /**
   * Bump this to force a fresh fetch (bypassing the session cache) — e.g. a
   * manual "reload comments" button. Changing it refetches page 0.
   */
  reloadToken?: number;
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
  fileUniqueId,
  fileCreatedAt,
  fileIsAdult,
  currentUserId: initialUserId,
  fileOwnerId,
  isReel = false,
  commentsEnabled = true,
  highlightCommentId = null,
  className,
  fillHeight = false,
  fileDurationSec,
  reloadToken = 0,
}: CommentSectionProps) => {
  const imageUploadContext: CommentImageUploadContext | undefined = (() => {
    const uniqueId = fileUniqueId?.trim();
    if (!uniqueId || !fileCreatedAt) return undefined;
    const dateFolder = arrangeDateForThumbnail(fileCreatedAt);
    if (!dateFolder) return undefined;
    return { uniqueId, dateFolder, isAdult: Boolean(fileIsAdult) };
  })();

  const [comments, setComments] = useState<Comment[]>(
    () => commentCache.get(fileId)?.comments ?? [],
  );
  const [totalRootCount, setTotalRootCount] = useState(
    () => commentCache.get(fileId)?.totalCount ?? 0,
  );
  const [isLoading, setIsLoading] = useState(() => !commentCache.has(fileId));
  const [loadingMore, setLoadingMore] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentUserId] = useState<string | undefined>(initialUserId);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreSignInOpen, setLoadMoreSignInOpen] = useState(false);
  const [lastRootBatchSize, setLastRootBatchSize] = useState(0);
  const channelRef = useRef<any>(null);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const composerShellRef = useRef<HTMLDivElement>(null);
  const sidebarCtx = useSidebarOptional();
  const [composerDock, setComposerDock] = useState<{
    left: number;
    width: number;
    bottom: number;
  } | null>(null);
  const [dockedComposerHeight, setDockedComposerHeight] = useState(0);

  const loadedRootCount = comments.length;
  const hasMoreComments =
    loadedRootCount > 0 &&
    loadedRootCount < totalRootCount &&
    (lastRootBatchSize >= COMMENTS_PAGE_SIZE || loadedRootCount === 0);

  const fetchCommentPage = useCallback(
    async (offset: number, append: boolean) => {
      const params = new URLSearchParams({
        fileId,
        limit: String(COMMENTS_PAGE_SIZE),
        offset: String(offset),
      });
      if (highlightCommentId) {
        params.set("focusCommentId", highlightCommentId);
      }
      const response = await fetch(`/api/comments?${params.toString()}`, {
        credentials: "include",
      });

      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const msg =
          result &&
          typeof result === "object" &&
          "error" in result &&
          typeof (result as { error?: string }).error === "string"
            ? (result as { error: string }).error
            : "Failed to fetch comments";
        throw new Error(msg);
      }

      if (!result?.success) {
        throw new Error(
          result &&
            typeof result === "object" &&
            "error" in result &&
            typeof (result as { error?: string }).error === "string"
            ? (result as { error: string }).error
            : "Failed to load comments",
        );
      }

      const batch = Array.isArray(result.data) ? result.data : [];
      const apiRootTotal =
        typeof result.totalCount === "number" ? result.totalCount : batch.length;
      setComments((prev) => (append ? [...prev, ...batch] : batch));
      setTotalRootCount(apiRootTotal);
      setLastRootBatchSize(batch.length);
      setError(null);
      return batch;
    },
    [fileId, highlightCommentId],
  );

  const fetchComments = useCallback(async () => {
    try {
      setIsLoading(true);
      await fetchCommentPage(0, false);
    } catch (err) {
      console.error("Error fetching comments:", err);
      setError(err instanceof Error ? err.message : "Failed to load comments");
    } finally {
      setIsLoading(false);
    }
  }, [fetchCommentPage]);

  const loadMoreComments = useCallback(async () => {
    if (!currentUserId) {
      setLoadMoreSignInOpen(true);
      return;
    }
    if (loadingMore || !hasMoreComments) return;
    try {
      setLoadingMore(true);
      await fetchCommentPage(comments.length, true);
    } catch (err) {
      console.error("Error loading more comments:", err);
      setError(err instanceof Error ? err.message : "Failed to load more comments");
    } finally {
      setLoadingMore(false);
    }
  }, [
    currentUserId,
    loadingMore,
    hasMoreComments,
    fetchCommentPage,
    comments.length,
  ]);

  // Seed from cache on (re)mount / file change; only hit the network when we
  // have nothing cached. Keyed on fileId only so a resize-triggered remount or
  // a parent re-render never re-fetches.
  useEffect(() => {
    const cached = commentCache.get(fileId);
    if (cached) {
      setComments(cached.comments);
      setTotalRootCount(cached.totalCount);
      setIsLoading(false);
      return;
    }
    void fetchComments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  // Manual reload: refetch page 0, bypassing the cache seed. Skipped on mount
  // (token starts at 0) so it only fires on an explicit bump.
  useEffect(() => {
    if (!reloadToken) return;
    void fetchComments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken]);

  // Keep the cache in lockstep with what's on screen (initial load, load-more,
  // posts, edits, deletes) so the next remount restores the exact same view.
  useEffect(() => {
    if (isLoading) return;
    writeCommentCache(fileId, comments, totalRootCount);
  }, [fileId, comments, totalRootCount, isLoading]);

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
        goToLogin();
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
            goToLogin();
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
          setTotalRootCount((n) => n + 1);
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

        // Server cascades soft-delete to all nested replies  refetch to stay in sync
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

  const handlePin = useCallback(
    async (commentId: string, pinned: boolean) => {
      if (!currentUserId) return;
      setError(null);
      try {
        const response = await fetch("/api/comments", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ commentId, pinned }),
        });
        if (!response.ok) {
          const errBody = await response.json();
          throw new Error(errBody.error || "Failed to pin comment");
        }
        // Pins are top-level only and one per file: clear any existing pin,
        // set the new state, and float the pinned comment to the top.
        setComments((prev) => {
          const next = prev.map((c) =>
            c.id === commentId
              ? { ...c, is_pinned: pinned }
              : c.is_pinned
                ? { ...c, is_pinned: false }
                : c,
          );
          if (!pinned) return next;
          const idx = next.findIndex((c) => c.id === commentId);
          if (idx <= 0) return next;
          const target = next[idx];
          next.splice(idx, 1);
          return [target, ...next];
        });
      } catch (err) {
        console.error("Error pinning comment:", err);
        setError("Failed to pin comment");
      }
    },
    [currentUserId]
  );

  const showComposer = Boolean(commentsEnabled && currentUserId);
  const hasThread = !isLoading && comments.length > 0;
  const isEmpty = !isLoading && (comments.length === 0 || totalRootCount === 0);
  /** One scroll container for thread + composer so sticky bottom-0 can pin to the panel. */
  const useScrollShell = fillHeight || isLoading || hasThread || (isEmpty && showComposer);

  useEffect(() => {
    if (fillHeight || !showComposer) {
      setComposerDock(null);
      setDockedComposerHeight(0);
      return;
    }
    const anchor = scrollAnchorRef.current;
    if (!anchor) return;

    const scrollRoot = getPageScrollRoot();

    const sync = () => {
      const rect = anchor.getBoundingClientRect();
      const scrollRootRect = scrollRoot?.getBoundingClientRect();
      const viewportTop = scrollRootRect?.top ?? 0;
      const viewportBottom = scrollRootRect?.bottom ?? window.innerHeight;
      const bottomNavH = readAppBottomNavHeightPx();
      const inView = rect.top < viewportBottom - bottomNavH && rect.bottom > viewportTop + 96;

      setComposerDock(
        inView
          ? {
              left: rect.left,
              width: rect.width,
              bottom: bottomNavH,
            }
          : null,
      );
    };

    sync();

    const ro = new ResizeObserver(sync);
    ro.observe(anchor);
    if (scrollRoot) ro.observe(scrollRoot);

    const sidebarWrapper = document.querySelector('[data-slot="sidebar-wrapper"]');
    if (sidebarWrapper instanceof HTMLElement) ro.observe(sidebarWrapper);

    const sidebarInset = document.querySelector('[data-slot="sidebar-inset"]');
    if (sidebarInset instanceof HTMLElement) ro.observe(sidebarInset);

    scrollRoot?.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync, { passive: true });

    return () => {
      ro.disconnect();
      scrollRoot?.removeEventListener("scroll", sync);
      window.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, [
    fillHeight,
    showComposer,
    fileId,
    comments.length,
    sidebarCtx?.state,
    sidebarCtx?.open,
    sidebarCtx?.isMobile,
  ]);

  useEffect(() => {
    if (fillHeight || !composerDock) {
      setDockedComposerHeight(0);
      return;
    }
    const el = composerShellRef.current;
    if (!el) return;

    const measure = () => {
      setDockedComposerHeight(el.getBoundingClientRect().height);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fillHeight, composerDock, comments.length]);

  const dockComposer = composerDock != null && !fillHeight;

  const composerShellClass = cn(
    "z-20 shrink-0 border-t border-border/60 bg-background/95 shadow-[0_-8px_24px_-8px_rgba(0,0,0,0.1)] backdrop-blur-md supports-[backdrop-filter]:bg-background/85 dark:shadow-[0_-8px_24px_-8px_rgba(0,0,0,0.35)]",
    fillHeight
      ? "mt-auto px-3 pt-1.5 pb-[max(0.125rem,env(safe-area-inset-bottom))]"
      : cn(
          "pt-2 pb-[max(0.35rem,env(safe-area-inset-bottom))]",
          dockComposer
            ? "fixed z-30"
            : "sticky z-20 bottom-[var(--app-bottom-nav-h,0px)]",
        ),
  );

  const composerNode = showComposer ? (
    <div
      ref={composerShellRef}
      className={composerShellClass}
      style={
        dockComposer && composerDock
          ? {
              left: composerDock.left,
              width: composerDock.width,
              bottom: composerDock.bottom,
            }
          : undefined
      }
    >
      <CommentForm
        fileId={fileId}
        imageUploadContext={imageUploadContext}
        onSubmit={(content, gif, image) => handleSubmit(content, undefined, gif, image)}
      />
    </div>
  ) : null;

  const loadMoreFooter =
    hasMoreComments && !isLoading ? (
      <div className="flex justify-center border-t border-border/40 px-2 py-4">
        {currentUserId ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loadingMore}
            onClick={() => void loadMoreComments()}
            className="min-w-[10rem] gap-2"
          >
            {loadingMore ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </>
            ) : (
              `Load more (${loadedRootCount} of ${totalRootCount} threads)`
            )}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLoadMoreSignInOpen(true)}
            className="gap-2"
          >
            Sign in to load more comments
          </Button>
        )}
      </div>
    ) : null;

  const commentList = (
    <>
      {comments.map((comment) => (
        <CommentItem
          key={comment.id}
          comment={comment}
          currentUserId={currentUserId}
          fileOwnerId={fileOwnerId}
          fileId={fileId}
          imageUploadContext={imageUploadContext}
          allowNewComments={Boolean(commentsEnabled && currentUserId)}
          onReply={handleReply}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onHide={handleHide}
          onPin={handlePin}
          onLike={handleLike}
          highlightCommentId={highlightCommentId}
          fileDurationSec={fileDurationSec}
        />
      ))}
      {loadMoreFooter}
    </>
  );

  const threadScrollClass = cn(
    "min-w-0 space-y-0 px-0.5",
    fillHeight ? "pb-2" : "pb-1",
  );

  const threadPanel =
    isLoading ? (
      <div
        className={cn(
          "min-h-[200px] space-y-5 px-0.5 py-4",
          fillHeight && "min-h-0 flex-1",
        )}
        aria-busy="true"
        aria-label="Loading comments"
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={`comment-skeleton-${i}`} className="flex gap-3">
            <div className="h-9 w-9 shrink-0 rounded-full bg-muted animate-pulse" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3 w-28 rounded bg-muted animate-pulse" />
              <div className="h-3 w-full max-w-[80%] rounded bg-muted animate-pulse" />
              <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    ) : hasThread ? (
      <div className={threadScrollClass}>{commentList}</div>
    ) : (
      <div className="flex flex-1 flex-col items-center justify-center px-2 py-6 text-center text-muted-foreground">
        <MessageSquare className="mx-auto mb-2 h-10 w-10 opacity-50" />
        <p className="text-sm">
          {!currentUserId || !commentsEnabled
            ? "No comments on this upload yet."
            : "No comments yet. Be the first to comment!"}
        </p>
      </div>
    );

  const threadWithComposer = showComposer ? (
    fillHeight ? (
      <>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pt-2 [scrollbar-gutter:stable]">
          {threadPanel}
        </div>
        {composerNode}
      </>
    ) : (
      <div className="flex min-h-full min-w-0 flex-col">
        {threadPanel}
        {dockComposer && dockedComposerHeight > 0 ? (
          <div className="shrink-0" style={{ height: dockedComposerHeight }} aria-hidden />
        ) : null}
        {composerNode}
      </div>
    )
  ) : (
    threadPanel
  );

  return (
    <div
      ref={scrollAnchorRef}
      className={cn(
        "flex min-h-0 flex-col",
        fillHeight ? "min-h-0 flex-1 gap-0" : "gap-2 sm:gap-3",
        className,
      )}
    >
      <CommentSignInDialog
        open={loadMoreSignInOpen}
        onOpenChange={setLoadMoreSignInOpen}
        title="Sign in to load more comments"
        description="You're viewing the first comments on this video. Sign in to load the rest of the thread."
      />

      {!commentsEnabled && currentUserId && (
        <div className="bg-muted/40 shrink-0 rounded-lg border border-border/50 px-3 py-2.5 text-center">
          <p className="text-sm text-muted-foreground">
            New comments and replies are disabled. Existing comments stay visible below.
          </p>
        </div>
      )}

      {error && (
        <div className="bg-destructive/10 text-destructive shrink-0 rounded-lg p-3 text-sm flex items-center justify-between gap-3">
          <span className="min-w-0">{error}</span>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => {
              setError(null);
              void fetchComments();
            }}
          >
            Try again
          </Button>
        </div>
      )}

      {!useScrollShell ? (
        <div className="text-center py-8 text-muted-foreground">
          <MessageSquare className="mx-auto mb-2 h-12 w-12 opacity-50" />
          <p>No comments on this upload yet.</p>
        </div>
      ) : fillHeight ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{threadWithComposer}</div>
      ) : (
        <div className="overflow-x-clip">{threadWithComposer}</div>
      )}
    </div>
  );
};

export default CommentSection;

