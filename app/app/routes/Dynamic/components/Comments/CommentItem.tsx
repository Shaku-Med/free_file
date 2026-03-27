import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { MoreVertical, Reply, Edit2, Trash2, Heart, EyeOff, Eye } from "lucide-react";
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
  /** When false, hide reply UI (file owner disabled new comments) */
  allowNewComments?: boolean;
  level?: number;
  highlightCommentId?: string | null;
  imageUploadDateFolder?: string;
  imageUploadUniqueId?: string;
}

function subtreeContainsHighlight(c: CommentType, targetId: string | null | undefined): boolean {
  if (!targetId) return false;
  if (c.id === targetId) return true;
  return (c.replies ?? []).some((r) => subtreeContainsHighlight(r, targetId));
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
  imageUploadDateFolder,
  imageUploadUniqueId,
}: CommentItemProps) => {
  const [isReplying, setIsReplying] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showReplies, setShowReplies] = useState(() =>
    !highlightCommentId ? true : subtreeContainsHighlight(comment, highlightCommentId)
  );
  const [likeCount, setLikeCount] = useState(comment.like_count ?? 0);
  const [userLiked, setUserLiked] = useState(comment.user_has_liked ?? false);
  const [liking, setLiking] = useState(false);
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

  return (
    <div
      id={`comment-${comment.id}`}
      className={cn(
        "space-y-3 scroll-mt-28 rounded-xl transition-[box-shadow,background-color] duration-500",
        level > 0 && "ml-8 border-l-2 border-muted pl-4",
        showEmphasis &&
          "ring-2 ring-primary/80 ring-offset-2 ring-offset-background bg-primary/10 shadow-sm p-2 -m-2 sm:p-3 sm:-m-3"
      )}
    >
      <div className="flex gap-3">
        {comment.user?.username ? (
          <Link to={`/profile/${comment.user.username}`}>
            <Avatar className="h-8 w-8 flex-shrink-0 hover:ring-2 ring-primary transition-all cursor-pointer">
              <AvatarImage src={getProfilePicUrl(comment.user.profile_pic)} alt={comment.user.username} />
              <AvatarFallback>
                {comment.user.username.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </Link>
        ) : (
          <Avatar className="h-8 w-8 flex-shrink-0">
            <AvatarFallback>U</AvatarFallback>
          </Avatar>
        )}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {comment.user?.username ? (
                  <Link 
                    to={`/profile/${comment.user.username}`}
                    className="text-sm font-medium text-foreground hover:text-primary transition-colors"
                  >
                    {comment.user.username}
                  </Link>
                ) : (
                  <span className="text-sm font-medium text-foreground">
                    Unknown User
                  </span>
                )}
                {comment.is_edited && (
                  <span className="text-xs text-muted-foreground">(edited)</span>
                )}
                {isFileOwner && isHidden && (
                  <span className="text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
                    Hidden
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                </span>
              </div>
              {isEditing ? (
                <CommentForm
                  fileId={fileId}
                  onSubmit={handleEdit}
                  onCancel={() => setIsEditing(false)}
                  placeholder="Edit your comment..."
                  imageUploadDateFolder={imageUploadDateFolder}
                  imageUploadUniqueId={imageUploadUniqueId}
                />
              ) : (
                <div
                  ref={contentRef}
                  className="text-sm text-foreground border-0 space-y-1 relative select-none"
                  onClick={handleContentClick}
                  onTouchEnd={handleContentTouchEnd}
                >
                  {comment.content ? (
                    <div>
                      <FormattedText text={comment.content} />
                    </div>
                  ) : null}
                  {comment.gif_url || comment.gif_preview_url ? (
                    <img
                      src={comment.gif_preview_url || comment.gif_url || ""}
                      alt="GIF"
                      className="max-h-40 w-auto rounded-lg border border-border object-cover"
                    />
                  ) : null}
                  {comment.image_url ? (
                    <div className="inline-block max-w-full max-h-60 align-top">
                      <ImageLoad
                        key={`comment-img-${comment.id}-${commentImageRetry}`}
                        link={`/api/load/image/${comment.image_url}`}
                        imageID={`comment-img-${comment.id}`}
                        retry={retryCommentImage}
                        className="max-h-60 max-w-full rounded-lg border border-border object-contain"
                        hasAdultTag={false}
                        shouldShowPreview={true}
                      />
                    </div>
                  ) : null}
                  {/* Floating hearts on double-tap */}
                  {floatingHearts.length > 0 && (
                    <div className="absolute inset-0 overflow-visible pointer-events-none z-10">
                      {floatingHearts.map((h) => (
                        <Heart
                          key={h.id}
                          className="absolute text-primary fill-primary drop-shadow-md"
                          style={{
                            left: h.x,
                            top: h.y,
                            width: h.size,
                            height: h.size,
                            transform: `rotate(${h.rotation}deg)`,
                            animation: `heart-float 1s ease-out ${h.delay}ms forwards`,
                            ['--drift' as string]: `${h.drift}px`,
                            opacity: 0,
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            {canModerate && !isEditing && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="h-6 w-6">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {isCommentOwner && (
                    <DropdownMenuItem onClick={() => setIsEditing(true)}>
                      <Edit2 className="h-4 w-4 mr-2" />
                      Edit
                    </DropdownMenuItem>
                  )}
                  {isFileOwner && onHide && (
                    <DropdownMenuItem onClick={() => onHide(comment.id, !isHidden)}>
                      {isHidden ? <Eye className="h-4 w-4 mr-2" /> : <EyeOff className="h-4 w-4 mr-2" />}
                      {isHidden ? "Unhide" : "Hide from others"}
                    </DropdownMenuItem>
                  )}
                  {(isCommentOwner || isFileOwner) && (
                    <DropdownMenuItem onClick={handleDelete} className="text-destructive">
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {!isEditing && (
            <div className="flex items-center gap-2 flex-wrap">
              {onLike && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleLike}
                  disabled={liking || !currentUserId}
                  className={`h-7 text-xs gap-1 ${userLiked ? "text-primary" : ""}`}
                >
                  <Heart className={`h-3 w-3 ${userLiked ? "fill-current" : ""}`} />
                  {likeCount > 0 ? likeCount : "Like"}
                </Button>
              )}
              {allowNewComments && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsReplying(!isReplying)}
                  className="h-7 text-xs"
                >
                  <Reply className="h-3 w-3 mr-1" />
                  Reply
                </Button>
              )}
              {hasReplies && level === 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowReplies(!showReplies)}
                  className="h-7 text-xs"
                >
                  {showReplies ? "Hide" : "Show"} {comment.reply_count} {comment.reply_count === 1 ? "reply" : "replies"}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {allowNewComments && isReplying && (
        <div className="ml-11">
          <CommentForm
            fileId={fileId}
            parentId={comment.id}
            onSubmit={(content, gif, image) => handleReply(content, gif, image)}
            onCancel={() => setIsReplying(false)}
            placeholder="Write a reply..."
            imageUploadDateFolder={imageUploadDateFolder}
            imageUploadUniqueId={imageUploadUniqueId}
          />
        </div>
      )}

      {showReplies && hasReplies && (
        <div className="space-y-3 mt-2">
          {comment.replies?.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              currentUserId={currentUserId}
              fileOwnerId={fileOwnerId}
              fileId={fileId}
              imageUploadDateFolder={imageUploadDateFolder}
              imageUploadUniqueId={imageUploadUniqueId}
              allowNewComments={allowNewComments}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
              onHide={onHide}
              onLike={onLike}
              level={level + 1}
              highlightCommentId={highlightCommentId}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default CommentItem;

