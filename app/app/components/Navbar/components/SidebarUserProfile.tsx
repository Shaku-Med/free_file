import { Link } from "react-router";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { LogIn, User, Settings, LogOut, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "~/components/ui/dropdown-menu";
import { useFileContext } from "~/lib/Context/Context";
import { getProfilePicUrl } from "~/lib/utils/profilePic";

const SidebarUserProfile = () => {
  const { userId, userProfile, userProfileLoading } = useFileContext();

  const handleLogout = () => {
    // Use server-side logout so HttpOnly cookies are cleared correctly
    window.location.href = "/logout";
  };

  if (userProfileLoading && userId) {
    return (
      <div className="p-4">
        <div className="h-10 w-full bg-muted animate-pulse rounded"></div>
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
    ? (userProfile.about.length > 50 ? userProfile.about.substring(0, 50) + "..." : userProfile.about)
    : null;

  return (
    <div className="p-4 border-t border-sidebar-border">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors group text-left">
            <Avatar className="h-10 w-10 flex-shrink-0">
              <AvatarImage src={getProfilePicUrl(userProfile.profile_pic)} alt={userProfile.username} />
              <AvatarFallback>
                {userProfile.username.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <User className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <p className="font-medium text-sm text-foreground truncate group-hover:text-primary transition-colors">
                  {userProfile.username}
                </p>
              </div>
              {bioPreview && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {bioPreview}
                </p>
              )}
            </div>
            <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem asChild>
            <Link to={`/profile/${userProfile.username}`} className="flex items-center gap-2">
              <User className="h-4 w-4" />
              <span>Profile</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/settings" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              <span>Settings</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleLogout}
            variant="destructive"
            className="cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
            <span>Logout</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export default SidebarUserProfile;

