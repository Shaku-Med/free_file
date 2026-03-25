import { useState } from "react";
import EllipsisIcon from "./Icons/Ellipsis";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useSidebar } from "~/components/ui/sidebar";
import ShareIcon from "./Icons/Options/Share";
import AddIcon from "./Icons/Options/Add";
import { useLocalPlaylist } from "~/lib/hooks/useLocalPlaylist";
import { ShareModal } from "~/components/ShareModal";
import AddToPlaylistModal from "~/components/Playlist/AddToPlaylistModal";
import { ListPlus } from "lucide-react";

interface OptiontProps {
  fileId: string;
  uniqueId: string;
  isOwner: boolean;
  onEdit?: () => void;
  currentTime?: number;
}

const Optiont = ({ fileId, uniqueId, isOwner, onEdit, currentTime }: OptiontProps) => {
  const { isMobile, state } = useSidebar();
  const { has, toggle } = useLocalPlaylist();
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const inPlaylist = has(fileId);
  const shareUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/${uniqueId}`;

  const handleShare = () => setShareModalOpen(true);

  const handleTogglePlaylist = () => {
    toggle(fileId);
  };

  return (
    <div>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={`p-2 ${
            isMobile || state === "collapsed"
              ? "hover:bg-card/50"
              : "hover:bg-background"
          } rounded-full`}
        >
          <EllipsisIcon className="w-5 h-5 fill-current" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={handleShare}>
            <ShareIcon className="w-10 h-10 fill-current" />
            Share
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleTogglePlaylist}>
            <AddIcon className="w-10 h-10 fill-current" />
            {inPlaylist ? "Remove from local list" : "Save locally"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setAddToPlaylistOpen(true)}>
            <ListPlus className="w-5 h-5 mr-1" />
            Add to playlist
          </DropdownMenuItem>
          {isOwner && onEdit && (
            <DropdownMenuItem onClick={onEdit}>
              <svg className="w-10 h-10 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path opacity={0.5} d="M20.8487 8.71306C22.3844 7.17735 22.3844 4.68748 20.8487 3.15178C19.313 1.61607 16.8231 1.61607 15.2874 3.15178L14.4004 4.03882C14.4125 4.0755 14.4251 4.11268 14.4382 4.15035C14.7633 5.0875 15.3768 6.31601 16.5308 7.47002C17.6848 8.62403 18.9133 9.23749 19.8505 9.56262C19.8882 9.57574 19.9254 9.58843 19.9621 9.60072L20.8487 8.71306Z" />
                <path d="M14.4386 4.0498L3.73767 14.7507C3.34987 15.1385 3.07798 15.6269 2.95277 16.1634L2.04403 20.0514C1.96385 20.3941 2.06482 20.7529 2.31221 21.0003C2.55961 21.2477 2.91839 21.3487 3.26109 21.2685L7.14907 20.3598C7.68557 20.2346 8.17399 19.9627 8.56178 19.5749L19.2627 8.87401C19.2468 8.86738 19.2308 8.86057 19.2147 8.85359C18.2261 8.43386 16.8864 7.72728 15.58 6.42087C14.2735 5.11446 13.567 3.77472 13.1472 2.78614C13.1403 2.77008 13.1335 2.75415 13.1269 2.73835L14.4386 4.0498Z" />
              </svg>
              Edit
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ShareModal open={shareModalOpen} onOpenChange={setShareModalOpen} shareUrl={shareUrl} currentTime={currentTime} />
      <AddToPlaylistModal open={addToPlaylistOpen} onOpenChange={setAddToPlaylistOpen} fileId={fileId} />
    </div>
  );
};

export default Optiont;
