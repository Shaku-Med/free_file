import { Link } from "react-router";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { getProfilePicUrl } from "~/lib/utils/profilePic";

export interface OwnerInfo {
  id: string;
  username: string;
  profile_pic: string;
  verified?: boolean;
  about?: string | null;
}

interface OwnerProfileProps {
  owner: OwnerInfo | null;
  size?: "sm" | "md" | "lg";
  showUsername?: boolean;
  className?: string;
}

const sizeClasses = {
  sm: "h-8 w-8 text-sm",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base"
};

const OwnerProfile = ({ owner, size = "md", showUsername = true, className = "" }: OwnerProfileProps) => {
  if (!owner || !owner.username) {
    return null;
  }

  const avatarSize = sizeClasses[size];

  return (
    <Link 
      to={`/profile/${owner.username}`}
      className={`flex items-center gap-2 hover:text-primary transition-colors ${className} w-fit`}
      onClick={(e) => e.stopPropagation()}
    >
      <Avatar className={avatarSize}>
        <AvatarImage src={getProfilePicUrl(owner.profile_pic)} alt={owner.username} loading="lazy" />
        <AvatarFallback className="text-[10px]">
          {owner.username.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      {showUsername && (
        <span className="font-semibold text-foreground">
          {owner.username}
        </span>
      )}
    </Link>
  );
};

export default OwnerProfile;

