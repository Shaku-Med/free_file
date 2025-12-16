import { Link } from "react-router";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";

export interface OwnerInfo {
  id: string;
  username: string;
  profile_pic: string;
}

interface OwnerProfileProps {
  owner: OwnerInfo | null;
  size?: "sm" | "md" | "lg";
  showUsername?: boolean;
  className?: string;
}

const sizeClasses = {
  sm: "h-5 w-5 text-xs",
  md: "h-6 w-6 text-sm",
  lg: "h-8 w-8 text-base"
};

const OwnerProfile = ({ owner, size = "md", showUsername = true, className = "" }: OwnerProfileProps) => {
  if (!owner || !owner.username) {
    return null;
  }

  const avatarSize = sizeClasses[size];

  return (
    <Link 
      to={`/profile/${owner.username}`}
      className={`flex items-center gap-2 hover:text-primary transition-colors ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <Avatar className={avatarSize}>
        <AvatarImage src={owner.profile_pic} alt={owner.username} />
        <AvatarFallback className="text-[10px]">
          {owner.username.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      {showUsername && (
        <span className={`font-medium ${size === "sm" ? "text-xs" : size === "md" ? "text-sm" : "text-base"}`}>
          {owner.username}
        </span>
      )}
    </Link>
  );
};

export default OwnerProfile;

