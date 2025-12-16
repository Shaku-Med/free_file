import { useState } from "react";
import { Link } from "react-router";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { MoreVertical, Reply, Edit2, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import type { Comment as CommentType } from "~/lib/Services/CommentService";
import CommentForm from "./CommentForm";
import { formatDistanceToNow } from "date-fns";

interface CommentItemProps {
  comment: CommentType;
  currentUserId?: string;
  fileId: string;
  onReply: (parentId: string, content: string) => Promise<void>;
  onEdit: (commentId: string, content: string) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
  level?: number;
}

const CommentItem = ({
  comment,
  currentUserId,
  fileId,
  onReply,
  onEdit,
  onDelete,
  level = 0,
}: CommentItemProps) => {
  const [isReplying, setIsReplying] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showReplies, setShowReplies] = useState(level === 0);

  const isOwner = currentUserId === comment.user_id;
  const hasReplies = comment.replies && comment.replies.length > 0;

  const handleReply = async (content: string) => {
    await onReply(comment.id, content);
    setIsReplying(false);
    setShowReplies(true);
  };

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
    <div className={`space-y-3 ${level > 0 ? "ml-8 border-l-2 border-muted pl-4" : ""}`}>
      <div className="flex gap-3">
        {comment.user?.username ? (
          <Link to={`/profile/${comment.user.username}`}>
            <Avatar className="h-8 w-8 flex-shrink-0 hover:ring-2 ring-primary transition-all cursor-pointer">
              <AvatarImage src={comment.user.profile_pic} alt={comment.user.username} />
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
                />
              ) : (
                <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                  {comment.content}
                </p>
              )}
            </div>
            {isOwner && !isEditing && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="h-6 w-6">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setIsEditing(true)}>
                    <Edit2 className="h-4 w-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDelete} className="text-destructive">
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {!isEditing && (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsReplying(!isReplying)}
                className="h-7 text-xs"
              >
                <Reply className="h-3 w-3 mr-1" />
                Reply
              </Button>
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

      {isReplying && (
        <div className="ml-11">
          <CommentForm
            fileId={fileId}
            parentId={comment.id}
            onSubmit={handleReply}
            onCancel={() => setIsReplying(false)}
            placeholder="Write a reply..."
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
              fileId={fileId}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default CommentItem;

