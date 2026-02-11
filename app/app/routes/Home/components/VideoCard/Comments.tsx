import { Link } from "react-router";
import CommentIcon from "./Icons/comments";
import { useSidebar } from "~/components/ui/sidebar";

interface CommentsProps {
  uniqueId: string;
  commentCount: number;
}

const Comments = ({ uniqueId, commentCount }: CommentsProps) => {
  const { isMobile, state } = useSidebar();
  const hoverClass = isMobile || state === "collapsed" ? "hover:bg-card/50" : "hover:bg-background";
  return (
    <Link
      to={`/${uniqueId}`}
      onClick={(e) => e.stopPropagation()}
      className={`flex items-center justify-center gap-1 p-2 rounded-r-full ${hoverClass}`}
    >
      <CommentIcon className="w-5 h-5 fill-current" />
      <span className="text-sm tabular-nums">{commentCount >= 1000 ? `${(commentCount / 1000).toFixed(1)}K` : commentCount}</span>
    </Link>
  );
};

export default Comments;
