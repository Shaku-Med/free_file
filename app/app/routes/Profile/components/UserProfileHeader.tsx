import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Calendar, Edit2 } from "lucide-react";
import type { UserProfile } from "~/lib/Services/UserProfileService";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import EditProfileDialog from "./EditProfileDialog";

interface UserProfileHeaderProps {
  profile: UserProfile;
  isOwner: boolean;
}

const UserProfileHeader = ({ profile, isOwner }: UserProfileHeaderProps) => {
  const [isEditOpen, setIsEditOpen] = useState(false);

  return (
    <div className="space-y-8 mb-12">
      {/* Large centered profile picture */}
      <div className="flex flex-col items-center justify-center space-y-6">
        <div className="relative">
          <Avatar className="h-40 w-40 sm:h-48 sm:w-48 border-4 border-border shadow-lg">
            <AvatarImage src={profile.profile_pic} alt={profile.username} className="object-cover" />
            <AvatarFallback className="text-4xl sm:text-5xl">
              {profile.username.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </div>

        <div className="text-center space-y-4 w-full max-w-2xl">
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <h1 className="text-4xl sm:text-5xl font-bold text-foreground">{profile.username}</h1>
            {isOwner && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditOpen(true)}
                className="gap-2"
              >
                <Edit2 className="h-4 w-4" />
                Edit Profile
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4" />
              <span>Joined {formatDistanceToNow(new Date(profile.created_at), { addSuffix: true })}</span>
            </div>
            <span className="font-medium">{profile.file_count || 0} {profile.file_count === 1 ? 'upload' : 'uploads'}</span>
          </div>

          {profile.about && (
            <p className="text-foreground text-center text-lg leading-relaxed max-w-xl mx-auto">
              {profile.about}
            </p>
          )}
        </div>
      </div>

      {isOwner && (
        <EditProfileDialog
          profile={profile}
          isOpen={isEditOpen}
          onClose={() => setIsEditOpen(false)}
        />
      )}
    </div>
  );
};

export default UserProfileHeader;
