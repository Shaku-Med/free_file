import { useState, useEffect } from "react";
import { Link } from "react-router";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { LogIn, User } from "lucide-react";
import { useFileContext } from "~/lib/Context/Context";

interface UserProfileData {
  id: string;
  username: string;
  profile_pic: string;
  about: string | null;
}

const SidebarUserProfile = () => {
  const { userId } = useFileContext();
  const [userProfile, setUserProfile] = useState<UserProfileData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchUserProfile = async () => {
      if (!userId) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/user-profile?userId=${userId}`);
        if (response.ok) {
          const data = await response.json();
          setUserProfile(data);
        }
      } catch (error) {
        console.error("Error fetching user profile:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchUserProfile();
  }, [userId]);

  if (isLoading) {
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
    <div className="p-4 border-t border-sidebar-border space-y-3">
      <Link
        to={`/profile/${userProfile.username}`}
        className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors group"
      >
        <Avatar className="h-10 w-10 flex-shrink-0">
          <AvatarImage src={userProfile.profile_pic} alt={userProfile.username} />
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
      </Link>
    </div>
  );
};

export default SidebarUserProfile;

