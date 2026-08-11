import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { MoreVertical, Edit2, Trash2, ThumbsUp, Heart, EyeOff, Eye, Pin, PinOff } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import type { Comment as CommentType } from "~/lib/Services/CommentService";
import CommentForm from "./CommentForm";
import type { CommentGif, CommentImage, CommentImageUploadContext } from "./CommentForm";
import { FormattedText } from "~/components/FormattedText";
import { formatDistanceToNow } from "date-fns";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import { cn } from "~/lib/utils";
import ImageLoad from "~/routes/Home/components/ImageLoad/ImageLoad";
import {
  CommentThreadRails,
  CommentThreadElbow,
  COMMENT_AVATAR_SIZE_PX,
  commentThreadGutterWidthPx,
} from "./CommentThreadConnector";
import { CommentLikesModal } from "./CommentLikesModal";
import { CommentSignInDialog } from "./CommentSignInDialog";
import { readReplyCache, writeReplyCache, REPLY_CACHE_STALE_MS } from "./replyCache";
import { signedFetch } from "~/lib/Security/requestSigning.client";

const REPLIES_PAGE_SIZE = 50;

interface CommentItemProps {
  comment: CommentType;
  currentUserId?: string;
  fileOwnerId?: string;
  fileId: string;
  /** Parent file's adult flag  a comment image inherits it, so the image
   *  loader sends the auth details the load server needs to blur/gate it. */
  fileIsAdult?: boolean | null;
  imageUploadContext?: CommentImageUploadContext;
  /** Resolves with the created comment so threads can append it without a refetch. */
  onReply: (
    parentId: string,
    content: string,
    gif?: CommentGif | null,
    image?: CommentImage | null
  ) => Promise<CommentType | void>;
  onEdit: (commentId: string, content: string) => Promise<void>;
  /** Resolves with how many comments the delete removed (a thread delete cascades). */
  onDelete: (commentId: string) => Promise<number | void>;
  onHide?: (commentId: string, hidden: boolean) => Promise<void>;
  onPin?: (commentId: string, pinned: boolean) => Promise<void>;
  onLike?: (commentId: string) => Promise<void>;
  allowNewComments?: boolean;
  level?: number;
  highlightCommentId?: string | null;
  isLastInThread?: boolean;
  /** Per nesting depth: vertical rail in column i if ancestor at that depth had a younger sibling. */
  threadPrefix?: boolean[];
  /** Called by child rails when user clicks the own-column line to fold the parent. */
  onParentFold?: () => void;
  /** Video duration in seconds  enables timestamp linkification when set. */
  fileDurationSec?: number;
}

function subtreeContainsHighlight(c: CommentType, targetId: string | null | undefined): boolean {
  if (!targetId) return false;
  if (c.id === targetId) return true;
  return (c.replies ?? []).some((r) => subtreeContainsHighlight(r, targetId));
}

/** YouTube-style full phrase: “5 months ago” */
function youtubeRelativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "";
  }
}

function formatCompactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

const CommentItem = ({
  comment,
  currentUserId,
  fileOwnerId,
  fileId,
  fileIsAdult,
  imageUploadContext,
  onReply,
  onEdit,
  onDelete,
  onHide,
  onPin,
  onLike,
  allowNewComments = true,
  level = 0,
  highlightCommentId = null,
  isLastInThread = true,
  threadPrefix = [],
  onParentFold,
  fileDurationSec,
}: CommentItemProps) => {
  const [isReplying, setIsReplying] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  /**
   * Replies arrive empty from the list endpoint and are fetched when opened, so
   * a thread with hundreds of replies costs nothing until someone asks for it.
   * Seed order: the session reply cache (a thread fetched earlier this session
   * survives remounts and never refetches on open), then whatever branch the
   * server sent (deep links), then empty.
   */
  const cachedThread = readReplyCache(fileId, comment.id);
  const [loadedReplies, setLoadedReplies] = useState<CommentType[] | null>(
    () => cachedThread?.replies ?? (comment.replies && comment.replies.length > 0 ? comment.replies : null)
  );
  /** Mirror of loadedReplies for handlers, so none of them close over a stale list. */
  const loadedRepliesRef = useRef<CommentType[] | null>(loadedReplies);
  loadedRepliesRef.current = loadedReplies;
  /** Whole-subtree size shown on the "View N replies" control. */
  const [replyTotal, setReplyTotal] = useState(() => cachedThread?.replyTotal ?? comment.reply_count ?? 0);
  /** Direct children only — drives "Show more replies" pagination. */
  const [directTotal, setDirectTotal] = useState(
    () => cachedThread?.directTotal ?? comment.replies?.length ?? 0
  );
  /** When this thread last came from the server; 0 forces a background refresh on open. */
  const fetchedAtRef = useRef(cachedThread?.fetchedAt ?? 0);
  const [repliesLoading, setRepliesLoading] = useState(false);
  const [repliesError, setRepliesError] = useState(false);
  const [showReplies, setShowReplies] = useState(() =>
    highlightCommentId ? subtreeContainsHighlight(comment, highlightCommentId) : false
  );
  const [likeCount, setLikeCount] = useState(comment.like_count ?? 0);
  const [userLiked, setUserLiked] = useState(comment.user_has_liked ?? false);
  const [liking, setLiking] = useState(false);
  const [likesModalOpen, setLikesModalOpen] = useState(false);
  const [likesSignInOpen, setLikesSignInOpen] = useState(false);
  const [moreRepliesSignInOpen, setMoreRepliesSignInOpen] = useState(false);
  const [floatingHearts, setFloatingHearts] = useState<
    { id: number; x: number; y: number; size: number; drift: number; delay: number; rotation: number }[]
  >([]);
  const lastTapRef = useRef(0);
  const lastTapPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const heartIdRef = useRef(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [textExpanded, setTextExpanded] = useState(false);
  const [commentImageRetry, setCommentImageRetry] = useState(0);
  const retryCommentImage = useCallback(() => {
    setCommentImageRetry((n) => n + 1);
  }, []);

  useEffect(() => {
    setLikeCount(comment.like_count ?? 0);
    setUserLiked(comment.user_has_liked ?? false);
  }, [comment.like_count, comment.user_has_liked]);

  // Parent list refetches (delete, reload) hand down fresh server counts.
  // Skipped on mount so a fresher cache-seeded total isn't clobbered by the
  // possibly-stale count the parent list was still holding.
  const countSyncedOnceRef = useRef(false);
  useEffect(() => {
    if (!countSyncedOnceRef.current) {
      countSyncedOnceRef.current = true;
      return;
    }
    setReplyTotal(comment.reply_count ?? 0);
  }, [comment.reply_count]);

  // Write-through: whatever this thread shows is what the next mount restores.
  useEffect(() => {
    if (loadedReplies === null) return;
    writeReplyCache(fileId, comment.id, {
      replies: loadedReplies,
      directTotal,
      replyTotal,
      fetchedAt: fetchedAtRef.current,
    });
  }, [fileId, comment.id, loadedReplies, directTotal, replyTotal]);

  useEffect(() => {
    setCommentImageRetry(0);
  }, [comment.id, comment.image_url]);

  useEffect(() => {
    if (!allowNewComments) setIsReplying(false);
  }, [allowNewComments]);

  /**
   * Detect whether the text exceeds the clamp (4 lines). Re-measures on content / resize so
   * the "...more" toggle only appears when there's actually hidden text. YouTube does this too.
   */
  useEffect(() => {
    setTextExpanded(false);
    const el = textRef.current;
    if (!el) return;
    const measure = () => {
      // `scrollHeight > clientHeight` is the canonical "is clamped" check.
      setIsOverflowing(el.scrollHeight - el.clientHeight > 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [comment.content, comment.id]);

  const isCommentOwner = currentUserId === comment.user_id;
  const isFileOwner = Boolean(fileOwnerId && currentUserId === fileOwnerId);
  const canModerate = isCommentOwner || isFileOwner;
  const isHidden = Boolean(comment.is_hidden);
  const hasReplies = replyTotal > 0 || (loadedReplies?.length ?? 0) > 0;
  const isHighlighted = Boolean(highlightCommentId && comment.id === highlightCommentId);
  const [showEmphasis, setShowEmphasis] = useState(isHighlighted);

  useEffect(() => {
    if (!isHighlighted) {
      setShowEmphasis(false);
      return;
    }
    setShowEmphasis(true);
    const t = window.setTimeout(() => setShowEmphasis(false), 4500);
    return () => window.clearTimeout(t);
  }, [isHighlighted, comment.id]);

  /**
   * One page of direct replies. `append` continues a partially loaded thread;
   * otherwise the page replaces the list (fresh open, background refresh).
   * Totals self-heal from the response so what's displayed always matches
   * what the server will actually hand out. `silent` keeps the current list
   * on screen (no skeleton, no disabled buttons) — used to revalidate a
   * cached thread in the background.
   */
  const loadReplies = useCallback(
    async (offset: number, append: boolean, silent = false) => {
      if (!silent) {
        setRepliesLoading(true);
        setRepliesError(false);
      }
      try {
        const params = new URLSearchParams({
          fileId,
          parentId: comment.id,
          limit: String(REPLIES_PAGE_SIZE),
          offset: String(offset),
        });
        const res = await signedFetch(`/api/comments?${params.toString()}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as { data?: CommentType[]; totalCount?: number };
        const batch = Array.isArray(json.data) ? json.data : [];
        const direct =
          typeof json.totalCount === "number" ? json.totalCount : offset + batch.length;
        const next = append && loadedRepliesRef.current
          ? [...loadedRepliesRef.current, ...batch]
          : batch;
        fetchedAtRef.current = Date.now();
        setLoadedReplies(next);
        setDirectTotal(direct);
        setRepliesError(false);
        if (next.length >= direct) {
          setReplyTotal(next.reduce((n, r) => n + 1 + (r.reply_count ?? 0), 0));
        } else {
          setReplyTotal((n) => Math.max(n, direct));
        }
      } catch {
        // Leave loadedReplies as-is so a retry re-fetches instead of showing
        // an empty thread as though the replies were gone. A failed silent
        // refresh changes nothing: the cached thread stays up.
        if (!silent) setRepliesError(true);
      } finally {
        if (!silent) setRepliesLoading(false);
      }
    },
    [fileId, comment.id]
  );

  const toggleReplies = useCallback(async () => {
    // Reply threads are signed-in only and the API enforces it, so ask for
    // sign-in up front rather than firing a request that comes back 401.
    if (!currentUserId) {
      setMoreRepliesSignInOpen(true);
      return;
    }
    // "Retry" state: the thread is open but empty because the fetch failed —
    // that click should re-fetch, not fold the thread.
    const needsRetry = repliesError && loadedRepliesRef.current === null;
    if (showReplies && !needsRetry) {
      setShowReplies(false);
      return;
    }
    setShowReplies(true);
    if (repliesLoading) return;
    const cached = loadedRepliesRef.current;
    if (!needsRetry && cached !== null) {
      // Cached thread: shown instantly, nothing refetched. If the copy has
      // gone stale, refresh it silently behind what's already on screen —
      // but never while paginated past page one, or the refresh would fold
      // the extra pages the user just loaded.
      const stale = Date.now() - fetchedAtRef.current > REPLY_CACHE_STALE_MS;
      if (stale && cached.length <= REPLIES_PAGE_SIZE) {
        void loadReplies(0, false, true);
      }
      return;
    }
    await loadReplies(0, false);
  }, [showReplies, repliesError, repliesLoading, loadReplies, currentUserId]);

  const handleReply = async (content: string, gif?: CommentGif | null, image?: CommentImage | null) => {
    const created = await onReply(comment.id, content, gif, image);
    setIsReplying(false);
    setReplyTotal((n) => n + 1);
    setShowReplies(true);
    // The POST already returned the created comment: append it locally instead
    // of refetching the whole thread.
    if (created && typeof created === "object" && "id" in created) {
      if (loadedRepliesRef.current !== null) {
        setLoadedReplies((prev) => (prev ? [...prev, created] : [created]));
        setDirectTotal((n) => n + 1);
        return;
      }
      if (replyTotal === 0) {
        // First reply on a fresh thread: no server state to merge with.
        fetchedAtRef.current = Date.now();
        setLoadedReplies([created]);
        setDirectTotal(1);
        return;
      }
    }
    // Unloaded thread with existing replies (or no created row came back):
    // one fetch brings the thread up, new reply included.
    if (loadedRepliesRef.current === null) await loadReplies(0, false);
  };

  /**
   * A reply posted anywhere below this comment grows this comment's subtree
   * by one. Each level wraps the handler it passes down, so the whole
   * ancestor chain stays in step without any refetch. The created comment is
   * passed back down the chain so the direct parent can append it.
   */
  const handleChildReply = useCallback(
    async (parentId: string, content: string, gif?: CommentGif | null, image?: CommentImage | null) => {
      const created = await onReply(parentId, content, gif, image);
      setReplyTotal((n) => n + 1);
      return created;
    },
    [onReply]
  );

  /**
   * Nested edits patch this thread's local copy — the section-level tree only
   * holds roots, so without this an edited reply kept showing its old text.
   */
  const handleChildEdit = useCallback(
    async (commentId: string, content: string) => {
      await onEdit(commentId, content);
      setLoadedReplies((prev) =>
        prev
          ? prev.map((r) =>
              r.id === commentId
                ? { ...r, content, is_edited: true, updated_at: new Date().toISOString() }
                : r
            )
          : prev
      );
    },
    [onEdit]
  );

  /**
   * Child threads report deletes through here so every level of the chain can
   * drop the row and shrink its subtree count by however many comments the
   * cascade actually removed.
   */
  const handleChildDelete = useCallback(
    async (commentId: string): Promise<number> => {
      const result = await onDelete(commentId);
      const removed = typeof result === "number" ? result : 1;
      if (removed <= 0) return 0;
      const current = loadedRepliesRef.current;
      const wasDirect = Boolean(current?.some((r) => r.id === commentId));
      if (wasDirect) {
        setLoadedReplies((prev) => (prev ? prev.filter((r) => r.id !== commentId) : prev));
        setDirectTotal((n) => Math.max(0, n - 1));
      }
      setReplyTotal((n) => Math.max(0, n - removed));
      return removed;
    },
    [onDelete]
  );

  const handleLike = useCallback(async () => {
    if (!onLike || liking || !currentUserId) return;
    setLiking(true);
    try {
      await onLike(comment.id);
      const nextLiked = !userLiked;
      setUserLiked(nextLiked);
      setLikeCount((prev) => (nextLiked ? prev + 1 : prev - 1));
      // This object is also what the session reply cache holds, so patch it in
      // place — a remount then re-seeds with the like state the user last saw
      // instead of reverting to the value from the original fetch.
      comment.user_has_liked = nextLiked;
      comment.like_count = Math.max(0, (comment.like_count ?? 0) + (nextLiked ? 1 : -1));
    } finally {
      setLiking(false);
    }
  }, [onLike, liking, currentUserId, comment, userLiked]);

  const spawnHearts = useCallback((clientX: number, clientY: number) => {
    const container = contentRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const count = 5 + Math.floor(Math.random() * 4); // 5-8 hearts
    const newHearts = Array.from({ length: count }, () => {
      heartIdRef.current += 1;
      return {
        id: heartIdRef.current,
        x: x + (Math.random() - 0.5) * 20,
        y,
        size: 14 + Math.random() * 14, // 14-28px
        drift: (Math.random() - 0.5) * 60, // random horizontal drift
        delay: Math.random() * 150, // stagger start
        rotation: (Math.random() - 0.5) * 50, // random tilt
      };
    });
    setFloatingHearts((prev) => [...prev, ...newHearts]);
    // Remove after animation finishes
    setTimeout(() => {
      setFloatingHearts((prev) =>
        prev.filter((h) => !newHearts.some((n) => n.id === h.id))
      );
    }, 1200);
  }, []);

  const handleDoubleTapLike = useCallback(
    (clientX: number, clientY: number) => {
      if (!onLike || liking || !currentUserId) return;
      spawnHearts(clientX, clientY);
      // Only like (never unlike) on double-tap
      if (!userLiked) handleLike();
    },
    [onLike, liking, currentUserId, userLiked, handleLike, spawnHearts]
  );

  const handleContentClick = useCallback(
    (e: React.MouseEvent) => {
      const now = Date.now();
      const pos = { x: e.clientX, y: e.clientY };
      if (now - lastTapRef.current < 350) {
        handleDoubleTapLike(pos.x, pos.y);
        lastTapRef.current = 0;
      } else {
        lastTapRef.current = now;
        lastTapPosRef.current = pos;
      }
    },
    [handleDoubleTapLike]
  );

  const handleContentTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.changedTouches[0];
      if (!touch) return;
      const now = Date.now();
      const pos = { x: touch.clientX, y: touch.clientY };
      if (now - lastTapRef.current < 350) {
        handleDoubleTapLike(pos.x, pos.y);
        lastTapRef.current = 0;
      } else {
        lastTapRef.current = now;
        lastTapPosRef.current = pos;
      }
    },
    [handleDoubleTapLike]
  );

  const handleEdit = async (content: string) => {
    await onEdit(comment.id, content);
    setIsEditing(false);
  };

  const handleDelete = async () => {
    if (window.confirm("Are you sure you want to delete this comment?")) {
      await onDelete(comment.id);
    }
  };

  const gutterPx = level > 0 ? commentThreadGutterWidthPx(level) : 0;
  /** Avatar (`h-9`) + `gap-2` (8px)  aligns reply composer with the main row. */
  const replyComposerInset = COMMENT_AVATAR_SIZE_PX + 8;

  return (
    <div
      id={`comment-${comment.id}`}
      className={cn(
        "relative scroll-mt-24 transition-[box-shadow,background-color] duration-500 sm:scroll-mt-28",
        "border-b border-border/25 pb-4 pt-1 last:border-b-0 dark:border-white/[0.06]",
        level > 0 && "overflow-visible min-w-0",
        showEmphasis &&
          "rounded-xl ring-2 ring-primary/80 ring-offset-2 ring-offset-background bg-primary/10 shadow-sm p-2 -mx-1 sm:p-3 sm:-mx-2"
      )}
      style={level > 0 ? { paddingLeft: gutterPx } : undefined}
    >
      {/* Rails span the full outer height (this comment + its reply subtree). Clickable to fold parent. */}
      {level > 0 && (
        <CommentThreadRails
          level={level}
          threadPrefix={threadPrefix}
          isLastInThread={isLastInThread}
          onToggleFold={onParentFold}
        />
      )}
      {/* Row wrapper hosts the small L-elbow at the avatar's vertical center. */}
      <div className="relative">
        {level > 0 && <CommentThreadElbow level={level} />}
        {/* Parent stem: clickable line from avatar center down  toggles reply fold. */}
        {hasReplies && (
          <button
            type="button"
            onClick={() => void toggleReplies()}
            aria-label={showReplies ? "Collapse replies" : "Expand replies"}
            className="absolute z-[2] group/stem"
            style={{
              left: COMMENT_AVATAR_SIZE_PX / 2 - 8,
              width: 16,
              top: COMMENT_AVATAR_SIZE_PX,
              bottom: 0,
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
            }}
          >
            <span
              className={cn(
                "absolute left-1/2 top-0 bottom-0 -translate-x-1/2 transition-colors duration-150",
                showReplies
                  ? "bg-zinc-400/55 dark:bg-zinc-500/65 group-hover/stem:bg-zinc-400 dark:group-hover/stem:bg-zinc-400"
                  : "bg-zinc-400/30 dark:bg-zinc-500/30 group-hover/stem:bg-zinc-400 dark:group-hover/stem:bg-zinc-400",
              )}
              style={{ width: showReplies ? 1.5 : 3, borderRadius: showReplies ? 0 : 2 }}
            />
          </button>
        )}
        <div className="relative z-[1] flex items-start gap-3">
          {comment.user?.username ? (
            <Link to={`/profile/${comment.user.username}`} className="shrink-0 pt-0.5">
              <Avatar className="h-9 w-9 shrink-0 ring-offset-background transition-all hover:ring-2 hover:ring-zinc-400/50 cursor-pointer">
                <AvatarImage src={getProfilePicUrl(comment.user.profile_pic)} alt={comment.user.username} />
                <AvatarFallback className="text-xs font-medium">
                  {comment.user.username.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </Link>
          ) : (
            <Avatar className="h-9 w-9 shrink-0">
              <AvatarFallback className="text-xs font-medium">U</AvatarFallback>
            </Avatar>
          )}
          <div
            className={cn(
              "flex min-w-0 flex-1 flex-col gap-0",
              level > 0 ? "min-w-0 sm:min-w-[min(100%,15rem)]" : ""
            )}
          >
            {isEditing ? (
              <div className="w-full min-w-0">
                <CommentForm
                  fileId={fileId}
                  imageUploadContext={imageUploadContext}
                  onSubmit={handleEdit}
                  onCancel={() => setIsEditing(false)}
                  placeholder="Edit your comment..."
                />
              </div>
            ) : (
              <>
                <div className="flex w-full min-w-0 items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0">
                    {comment.user?.username ? (
                      <Link
                        to={`/profile/${comment.user.username}`}
                        className="text-sm font-semibold leading-snug text-foreground hover:text-primary"
                      >
                        @{comment.user.username}
                      </Link>
                    ) : (
                      <span className="text-sm font-semibold leading-snug text-foreground">@unknown</span>
                    )}
                    <span className="text-xs font-normal text-muted-foreground">
                      {youtubeRelativeTime(comment.created_at)}
                    </span>
                    {comment.is_edited && (
                      <span className="text-[11px] font-normal text-muted-foreground">(edited)</span>
                    )}
                    {comment.is_pinned && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <Pin className="h-2.5 w-2.5" />
                        Pinned
                      </span>
                    )}
                    {isFileOwner && isHidden && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                        Hidden
                      </span>
                    )}
                  </div>
                  {canModerate && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 rounded-full text-muted-foreground hover:bg-muted/60 sm:h-8 sm:w-8"
                        >
                          <MoreVertical className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {isCommentOwner && (
                          <DropdownMenuItem onClick={() => setIsEditing(true)}>
                            <Edit2 className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                        )}
                        {isFileOwner && onPin && comment.parent_id == null && (
                          <DropdownMenuItem onClick={() => onPin(comment.id, !comment.is_pinned)}>
                            {comment.is_pinned ? <PinOff className="mr-2 h-4 w-4" /> : <Pin className="mr-2 h-4 w-4" />}
                            {comment.is_pinned ? "Unpin" : "Pin to top"}
                          </DropdownMenuItem>
                        )}
                        {isFileOwner && onHide && (
                          <DropdownMenuItem onClick={() => onHide(comment.id, !isHidden)}>
                            {isHidden ? <Eye className="mr-2 h-4 w-4" /> : <EyeOff className="mr-2 h-4 w-4" />}
                            {isHidden ? "Unhide" : "Hide from others"}
                          </DropdownMenuItem>
                        )}
                        {(isCommentOwner || isFileOwner) && (
                          <DropdownMenuItem onClick={handleDelete} className="text-destructive">
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>

                <div
                  ref={contentRef}
                  className="relative mt-1 w-full max-w-full space-y-2 text-sm leading-relaxed text-foreground select-none"
                  onClick={handleContentClick}
                  onTouchEnd={handleContentTouchEnd}
                >
                  {comment.content ? (
                    <div className="[&_a]:break-words">
                      <div
                        ref={textRef}
                        className={cn(
                          "whitespace-pre-wrap break-words",
                          !textExpanded && "line-clamp-4",
                        )}
                      >
                        <FormattedText
                          text={comment.content}
                          mentionLinkClassName="!text-sky-600 hover:!text-sky-500 dark:!text-[#3ea6ff] dark:hover:!text-sky-300"
                          timestamps={
                            fileDurationSec != null && fileDurationSec > 0
                              ? { maxSeconds: fileDurationSec, fileId }
                              : undefined
                          }
                        />
                      </div>
                      {isOverflowing && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setTextExpanded((v) => !v);
                          }}
                          className="mt-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
                        >
                          {textExpanded ? "Show less" : "…more"}
                        </button>
                      )}
                    </div>
                  ) : null}
                  {comment.gif_url || comment.gif_preview_url ? (
                    <img
                      src={comment.gif_preview_url || comment.gif_url || ""}
                      alt="GIF"
                      loading="lazy"
                      decoding="async"
                      fetchPriority="low"
                      className="max-h-32 w-auto rounded-md border border-border/50 object-cover [content-visibility:auto] [contain:content] sm:max-h-40 sm:rounded-lg"
                    />
                  ) : null}
                  {comment.image_url ? (
                    <div className="inline-block max-h-48 max-w-full align-top sm:max-h-60">
                      <ImageLoad
                        key={`comment-img-${comment.id}-${commentImageRetry}`}
                        link={`/api/load/image/${comment.image_url}`}
                        imageID={`comment-img-${comment.id}`}
                        retry={retryCommentImage}
                        className="max-h-48 max-w-full rounded-md border border-border/50 object-contain sm:max-h-60 sm:rounded-lg"
                        hasAdultTag={Boolean(fileIsAdult)}
                        shouldShowPreview={true}
                      />
                    </div>
                  ) : null}
                  {floatingHearts.length > 0 && (
                    <div className="pointer-events-none absolute inset-0 z-10 overflow-visible">
                      {floatingHearts.map((h) => (
                        <Heart
                          key={h.id}
                          className="absolute fill-primary text-primary drop-shadow-md"
                          style={{
                            left: h.x,
                            top: h.y,
                            width: h.size,
                            height: h.size,
                            transform: `rotate(${h.rotation}deg)`,
                            animation: `heart-float 1s ease-out ${h.delay}ms forwards`,
                            ["--drift" as string]: `${h.drift}px`,
                            opacity: 0,
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-2 flex min-h-[1.25rem] flex-wrap items-center gap-x-1 gap-y-1 text-xs text-muted-foreground">
                  {onLike ? (
                    <span className="inline-flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={handleLike}
                        disabled={liking || !currentUserId}
                        className={cn(
                          "inline-flex items-center justify-center rounded-md p-1 font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-40",
                          userLiked && "text-foreground",
                        )}
                        aria-label={userLiked ? "Unlike" : "Like"}
                      >
                        <ThumbsUp
                          className={cn("h-4 w-4 shrink-0", userLiked && "fill-current text-foreground")}
                          strokeWidth={1.75}
                        />
                      </button>
                      {likeCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (!currentUserId) {
                              setLikesSignInOpen(true);
                              return;
                            }
                            setLikesModalOpen(true);
                          }}
                          className="rounded-md px-1.5 py-0.5 font-medium tabular-nums text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                        >
                          {formatCompactCount(likeCount)}
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                  {allowNewComments ? (
                    <button
                      type="button"
                      onClick={() => setIsReplying(!isReplying)}
                      className="rounded-md px-2 py-0.5 font-semibold uppercase tracking-wide text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground sm:text-xs"
                    >
                      Reply
                    </button>
                  ) : null}
                  {hasReplies ? (
                    <button
                      type="button"
                      onClick={() => void toggleReplies()}
                      disabled={repliesLoading}
                      aria-expanded={showReplies}
                      className="rounded-md px-2 py-0.5 font-semibold text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:opacity-60 sm:text-xs"
                    >
                      {repliesError
                        ? "Retry"
                        : `${showReplies ? "Hide" : "View"} ${formatCompactCount(
                            replyTotal || loadedReplies?.length || 0
                          )} ${(replyTotal || loadedReplies?.length || 0) === 1 ? "reply" : "replies"}`}
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {allowNewComments && isReplying && (
        <div
          className={cn(level > 0 ? "" : "ml-11")}
          style={
            level > 0
              ? { paddingLeft: gutterPx + replyComposerInset }
              : undefined
          }
        >
          <CommentForm
            fileId={fileId}
            imageUploadContext={imageUploadContext}
            parentId={comment.id}
            replyToUsername={comment.user?.username ?? null}
            onSubmit={(content, gif, image) => handleReply(content, gif, image)}
            onCancel={() => setIsReplying(false)}
            placeholder={`Reply to @${comment.user?.username ?? "user"}…`}
          />
        </div>
      )}

      {showReplies && repliesLoading && loadedReplies === null && (
        // First open of a thread we know has replies: skeleton rows where they
        // will appear. Threads already in the session cache never reach this —
        // they render instantly above.
        <div
          className="space-y-3 pb-1 pt-2"
          style={{ marginLeft: commentThreadGutterWidthPx(level + 1) - (level > 0 ? gutterPx : 0) }}
          aria-busy="true"
          aria-label="Loading replies"
        >
          {Array.from({ length: Math.min(Math.max(replyTotal, 1), 3) }).map((_, i) => (
            <div key={`reply-skeleton-${i}`} className="flex gap-2.5">
              <div className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-muted" />
              <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
                <div className="h-2.5 w-24 animate-pulse rounded bg-muted" />
                <div className="h-2.5 w-full max-w-[70%] animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      )}

      {showReplies && (loadedReplies?.length ?? 0) > 0 && (
        <div
          className="relative z-[1] space-y-0 overflow-visible"
          style={gutterPx > 0 ? { marginLeft: -gutterPx } : undefined}
        >
          {loadedReplies?.map((reply, idx, arr) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              currentUserId={currentUserId}
              fileOwnerId={fileOwnerId}
              fileId={fileId}
              fileIsAdult={fileIsAdult}
              imageUploadContext={imageUploadContext}
              allowNewComments={allowNewComments}
              onReply={handleChildReply}
              onEdit={handleChildEdit}
              onDelete={handleChildDelete}
              onHide={onHide}
              onPin={onPin}
              onLike={onLike}
              level={level + 1}
              highlightCommentId={highlightCommentId}
              isLastInThread={idx === arr.length - 1}
              threadPrefix={level === 0 ? [] : [...threadPrefix, !isLastInThread]}
              onParentFold={() => setShowReplies(false)}
              fileDurationSec={fileDurationSec}
            />
          ))}
          {loadedReplies && directTotal > loadedReplies.length && (
            <button
              type="button"
              onClick={() => {
                // The server rejects paginated reads without a session, so
                // ask for sign-in up front instead of surfacing a fetch error.
                if (!currentUserId) {
                  setMoreRepliesSignInOpen(true);
                  return;
                }
                void loadReplies(loadedReplies.length, true);
              }}
              disabled={repliesLoading}
              className="mt-1 rounded-md px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:opacity-60 sm:text-xs"
              style={{ marginLeft: commentThreadGutterWidthPx(level + 1) }}
            >
              {repliesLoading
                ? "Loading..."
                : `Show more replies (${loadedReplies.length} of ${formatCompactCount(directTotal)})`}
            </button>
          )}
        </div>
      )}

      <CommentLikesModal
        commentId={comment.id}
        open={likesModalOpen}
        onOpenChange={setLikesModalOpen}
        currentUserId={currentUserId}
      />
      <CommentSignInDialog
        open={likesSignInOpen}
        onOpenChange={setLikesSignInOpen}
        title="Sign in to see who liked this"
        description="Likes are visible to signed-in members only. Sign in to see who reacted to this comment."
      />
      <CommentSignInDialog
        open={moreRepliesSignInOpen}
        onOpenChange={setMoreRepliesSignInOpen}
        title="Sign in to see replies"
        description="Replies are visible to signed-in members only. Sign in to open this thread."
      />
    </div>
  );
};

export default CommentItem;

