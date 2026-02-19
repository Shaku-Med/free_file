import { Link } from "react-router";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useFileContext } from "~/lib/Context/Context";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import { LogIn, User, Settings, LogOut, ChevronDown, Heart } from "lucide-react";

type Variant = "sidebar" | "topbar";

interface UserProfileDropdownProps {
  variant: Variant;
}

function ProfileMenuContent({ username }: { username: string | undefined }) {
  return (
    <DropdownMenuContent align="end" className="w-56">
      <DropdownMenuItem asChild>
        <Link to={username ? `/profile/${username}` : "/"} className="flex items-center gap-2">
          <User className="h-4 w-4" />
          <span>Profile</span>
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link to="/playlist" className="flex items-center gap-2">
          <Heart className="h-4 w-4" />
          <span>Playlist</span>
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link to="/settings" className="flex items-center gap-2">
          <Settings className="h-4 w-4" />
          <span>Settings</span>
        </Link>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <Link to="/logout" className="flex items-center gap-2 text-destructive focus:text-destructive">
          <LogOut className="h-4 w-4" />
          <span>Log out</span>
        </Link>
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

export function UserProfileDropdown({ variant }: UserProfileDropdownProps) {
  const { userId, userProfile, userProfileLoading } = useFileContext();

  if (variant === "sidebar") {
    if (userProfileLoading && userId) {
      return (
        <div className="p-4">
          <div className="h-10 w-full bg-muted animate-pulse rounded" />
        </div>
      );
    }
    if (!userId || !userProfile) {
      return (
        <div className="p-4 border-t border-sidebar-border">
          <Button asChild className="w-full" variant="default">
            <Link to="/auth/login">
              <LogIn className="mr-2 h-4 w-4" />
              Sign In
            </Link>
          </Button>
        </div>
      );
    }
    const bioPreview = userProfile.about
      ? userProfile.about.length > 50
        ? userProfile.about.substring(0, 50) + "..."
        : userProfile.about
      : null;

    return (
      <div className="p-4 border-t border-sidebar-border">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors group text-left">
              <Avatar className="h-10 w-10 flex-shrink-0">
                <AvatarImage src={getProfilePicUrl(userProfile.profile_pic)} alt={userProfile.username} />
                <AvatarFallback>{userProfile.username.charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <User className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <p className="font-medium text-sm text-foreground truncate group-hover:text-primary transition-colors">
                    {userProfile.username}
                  </p>
                </div>
                {bioPreview && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{bioPreview}</p>
                )}
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <ProfileMenuContent username={userProfile.username} />
        </DropdownMenu>
      </div>
    );
  }

  // topbar
  if (!userId) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1.5 sm:gap-2 rounded-lg p-0.5 sm:px-1.5 sm:py-1 hover:bg-primary/10 ios-scale min-w-0 max-w-[120px] sm:max-w-[160px] md:max-w-[200px] shrink-0"
          aria-label="User menu"
        >
          {userProfileLoading ? (
            <div className="size-7 sm:size-8 shrink-0 rounded-full bg-muted animate-pulse" />
          ) : (
            <Avatar className="h-7 w-7 sm:h-8 sm:w-8 shrink-0 ring-2 ring-border">
              <AvatarImage src={getProfilePicUrl(userProfile?.profile_pic)} alt={userProfile?.username} />
              <AvatarFallback className="bg-primary/20 text-primary text-xs font-medium">
                {userProfile?.username?.charAt(0).toUpperCase() ?? "?"}
              </AvatarFallback>
            </Avatar>
          )}
          <span className="hidden sm:inline text-xs sm:text-sm font-medium text-foreground truncate">
            {userProfileLoading ? "..." : userProfile?.username ?? "Profile"}
          </span>
          <ChevronDown className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 text-muted-foreground hidden sm:block" />
        </button>
      </DropdownMenuTrigger>
      <ProfileMenuContent username={userProfile?.username} />
    </DropdownMenu>
  );
}
