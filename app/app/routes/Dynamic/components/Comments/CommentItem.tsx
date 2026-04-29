import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { MoreVertical, Edit2, Trash2, ThumbsUp, Heart, EyeOff, Eye } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import type { Comment as CommentType } from "~/lib/Services/CommentService";
import CommentForm from "./CommentForm";
import type { CommentGif, CommentImage } from "./CommentForm";
import { FormattedText } from "~/components/FormattedText";
import { formatDistanceToNow } from "date-fns";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import { cn } from "~/lib/utils";
import ImageLoad from "~/routes/Home/components/ImageLoad/ImageLoad";
import {
  CommentThreadConnector,
  COMMENT_AVATAR_SIZE_PX,
  commentThreadGutterWidthPx,
} from "./CommentThreadConnector";
import { CommentLikesModal } from "./CommentLikesModal";

interface CommentItemProps {
  comment: CommentType;
  currentUserId?: string;
  fileOwnerId?: string;
  fileId: string;
  onReply: (parentId: string, content: string, gif?: CommentGif | null, image?: CommentImage | null) => Promise<void>;
  onEdit: (commentId: string, content: string) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
  onHide?: (commentId: string, hidden: boolean) => Promise<void>;
  onLike?: (commentId: string) => Promise<void>;
  allowNewComments?: boolean;
  level?: number;
  highlightCommentId?: string | null;
  isLastInThread?: boolean;
  /** Per nesting depth: vertical rail in column i if ancestor at that depth had a younger sibling. */
  threadPrefix?: boolean[];
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
  onReply,
  onEdit,
  onDelete,
  onHide,
  onLike,
  allowNewComments = true,
  level = 0,
  highlightCommentId = null,
  isLastInThread = true,
  threadPrefix = [],
}: CommentItemProps) => {
  const [isReplying, setIsReplying] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showReplies, setShowReplies] = useState(() =>
    !highlightCommentId ? true : subtreeContainsHighlight(comment, highlightCommentId)
  );
  const [likeCount, setLikeCount] = useState(comment.like_count ?? 0);
  const [userLiked, setUserLiked] = useState(comment.user_has_liked ?? false);
  const [liking, setLiking] = useState(false);
  const [likesModalOpen, setLikesModalOpen] = useState(false);
  const [floatingHearts, setFloatingHearts] = useState<
    { id: number; x: number; y: number; size: number; drift: number; delay: number; rotation: number }[]
  >([]);
  const lastTapRef = useRef(0);
  const lastTapPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const heartIdRef = useRef(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const [commentImageRetry, setCommentImageRetry] = useState(0);
  const retryCommentImage = useCallback(() => {
    setCommentImageRetry((n) => n + 1);
  }, []);

  useEffect(() => {
    setLikeCount(comment.like_count ?? 0);
    setUserLiked(comment.user_has_liked ?? false);
  }, [comment.like_count, comment.user_has_liked]);

  useEffect(() => {
    setCommentImageRetry(0);
  }, [comment.id, comment.image_url]);

  useEffect(() => {
    if (!allowNewComments) setIsReplying(false);
  }, [allowNewComments]);

  const isCommentOwner = currentUserId === comment.user_id;
  const isFileOwner = Boolean(fileOwnerId && currentUserId === fileOwnerId);
  const canModerate = isCommentOwner || isFileOwner;
  const isHidden = Boolean(comment.is_hidden);
  const hasReplies = comment.replies && comment.replies.length > 0;
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

  const handleReply = async (content: string, gif?: CommentGif | null, image?: CommentImage | null) => {
    await onReply(comment.id, content, gif, image);
    setIsReplying(false);
    setShowReplies(true);
  };

  const handleLike = useCallback(async () => {
    if (!onLike || liking || !currentUserId) return;
    setLiking(true);
    try {
      await onLike(comment.id);
      setUserLiked((prev) => !prev);
      setLikeCount((prev) => (userLiked ? prev - 1 : prev + 1));
    } finally {
      setLiking(false);
    }
  }, [onLike, liking, currentUserId, comment.id, userLiked]);

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
  /** Avatar (`h-9`) + `gap-2` (8px) — aligns reply composer with the main row. */
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
      {/* One wrapper so space-y-3 does not add margin between absolute connector and flex row */}
      <div className="relative">
        {level > 0 && (
          <CommentThreadConnector
            level={level}
            threadPrefix={threadPrefix}
            isLastInThread={isLastInThread}
          />
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
                      <FormattedText
                        text={comment.content}
                        mentionLinkClassName="!text-sky-600 hover:!text-sky-500 dark:!text-[#3ea6ff] dark:hover:!text-sky-300"
                      />
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
                        hasAdultTag={false}
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
                          onClick={() => setLikesModalOpen(true)}
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
                      onClick={() => setShowReplies(!showReplies)}
                      className="rounded-md px-2 py-0.5 font-semibold text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground sm:text-xs"
                    >
                      {showReplies ? "Hide" : "View"} {comment.reply_count}{" "}
                      {comment.reply_count === 1 ? "reply" : "replies"}
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
            parentId={comment.id}
            onSubmit={(content, gif, image) => handleReply(content, gif, image)}
            onCancel={() => setIsReplying(false)}
            placeholder="Write a reply..."
          />
        </div>
      )}

      {showReplies && hasReplies && (
        <div className="relative z-[1] mt-0.5 space-y-0 overflow-visible sm:mt-1">
          {comment.replies?.map((reply, idx, arr) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              currentUserId={currentUserId}
              fileOwnerId={fileOwnerId}
              fileId={fileId}
              allowNewComments={allowNewComments}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
              onHide={onHide}
              onLike={onLike}
              level={level + 1}
              highlightCommentId={highlightCommentId}
              isLastInThread={idx === arr.length - 1}
              threadPrefix={level === 0 ? [] : [...threadPrefix, !isLastInThread]}
            />
          ))}
        </div>
      )}

      <CommentLikesModal
        commentId={comment.id}
        open={likesModalOpen}
        onOpenChange={setLikesModalOpen}
        currentUserId={currentUserId}
      />
    </div>
  );
};

export default CommentItem;

