import { Link } from "react-router";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import { BadgeCheck } from "lucide-react";

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
        <span className="flex items-center gap-1.5 font-semibold text-foreground">
          {owner.username}
          {owner.verified && <BadgeCheck className="h-4 w-4 text-muted-foreground shrink-0" aria-label="Verified" />}
        </span>
      )}
    </Link>
  );
};

export default OwnerProfile;

