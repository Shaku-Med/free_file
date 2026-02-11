import Liked from "./Liked";
import Disliked from "./Disliked";
import Comments from "./Comments";
import Optiont from "./Optiont";

interface ActionsProps {
  fileId: string;
  uniqueId: string;
  likeCount: number;
  dislikeCount: number;
  commentCount: number;
  liked: boolean;
  disliked: boolean;
  isOwner?: boolean;
  onEdit?: () => void;
  onUpdate?: (updates: { liked: boolean; disliked: boolean; like_count: number; dislike_count: number }) => void;
}

const Actions = ({ fileId, uniqueId, likeCount, dislikeCount, commentCount, liked, disliked, isOwner, onEdit, onUpdate }: ActionsProps) => {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center justify-between">
        <Liked fileId={fileId} likeCount={likeCount} liked={liked} onUpdate={onUpdate} />
        <Disliked fileId={fileId} dislikeCount={dislikeCount} disliked={disliked} onUpdate={onUpdate} />
        <Comments uniqueId={uniqueId} commentCount={commentCount} />
      </div>
      <div>
        <Optiont fileId={fileId} uniqueId={uniqueId} isOwner={isOwner ?? false} onEdit={onEdit} />
      </div>
    </div>
  );
};

export default Actions;
