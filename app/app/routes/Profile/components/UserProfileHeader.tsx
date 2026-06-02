import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Calendar, Edit2, Camera, Upload, X, FileUp, Users, UserCheck } from "lucide-react";
import type { UserProfile } from "~/lib/Services/UserProfileService";
import { formatDistanceToNow } from "date-fns";
import { useState, useRef, useEffect } from "react";
import EditProfileDialog from "./EditProfileDialog";
import ImageCropper from "~/routes/Profile/components/ImageCropper";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import ImgPreview from "~/routes/Home/components/ImageLoad/ImgPreview/ImgPreview";
import { bumpProfilePicCache } from "~/lib/profilePicCache.client";
import SubscribeButton, { formatSubscriberCount } from "~/components/SubscribeButton";

interface ChannelStats {
  subscriber_count: number;
  subscription_count: number;
  is_subscribed: boolean;
  notify: boolean;
}

interface UserProfileHeaderProps {
  profile: UserProfile;
  isOwner: boolean;
  currentUserId?: string | null;
  channelStats?: ChannelStats;
  onProfileUpdate?: (updatedProfile: Partial<UserProfile>) => void;
}

const UPLOAD_MSG_TRY_AGAIN = "Something went wrong. Please try again.";
const UPLOAD_MSG_NSFW = "That image can't be used as a profile photo.";
const UPLOAD_MSG_PICK_IMAGE = "Please choose a different image.";

function StatItem({ value, label, icon }: { value: string | number; label: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-3 sm:px-5">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-lg sm:text-xl font-bold text-foreground tabular-nums">{value}</span>
      </div>
      <span className="text-[11px] sm:text-xs text-muted-foreground font-medium">{label}</span>
    </div>
  );
}

const UserProfileHeader = ({
  profile,
  isOwner,
  currentUserId,
  channelStats,
  onProfileUpdate,
}: UserProfileHeaderProps) => {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [profilePic, setProfilePic] = useState(profile.profile_pic);
  const [avatarCacheKey, setAvatarCacheKey] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [showCropper, setShowCropper] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isUploading) {
      setProfilePic(profile.profile_pic);
    }
  }, [profile.profile_pic, isUploading]);

  const checkAspectRatio = (file: File): Promise<boolean> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const aspectRatio = img.width / img.height;
        const isSquare = Math.abs(aspectRatio - 1) < 0.01;
        resolve(isSquare);
      };
      img.onerror = () => resolve(false);
      img.src = URL.createObjectURL(file);
    });
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setUploadError(UPLOAD_MSG_PICK_IMAGE);
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setUploadError(UPLOAD_MSG_PICK_IMAGE);
      return;
    }

    setUploadError(null);
    setSelectedFile(file);

    const isSquare = await checkAspectRatio(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result as string);
      if (isSquare) {
        setShowCropper(false);
        handleDirectUpload(file);
      } else {
        setShowCropper(true);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDirectUpload = async (file: File, onProgress?: (progress: number) => void) => {
    setIsUploading(true);
    setUploadError(null);
    if (onProgress) onProgress(0);

    const formData = new FormData();
    formData.append('file', file);

    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress(Math.min(95, Math.max(5, percent)));
        }
      };

      xhr.onreadystatechange = () => {
        if (xhr.readyState !== XMLHttpRequest.DONE) return;
        let parsed: { success?: boolean; profile_pic?: string; nsfw?: boolean } = {};
        try {
          parsed = JSON.parse(xhr.responseText) as typeof parsed;
        } catch {
          /* ignore */
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          if (!parsed.success || !parsed.profile_pic) {
            setUploadError(UPLOAD_MSG_TRY_AGAIN);
            if (onProgress) onProgress(0);
            reject(new Error("upload"));
            return;
          }
          const path = parsed.profile_pic;
          if (onProgress) onProgress(100);
          setAvatarCacheKey((k) => k + 1);
          // Tell every other avatar in the app (navbar, sidebar, comment
          // authors, mini-player owner badge, etc.) to refetch this user's pic.
          bumpProfilePicCache(profile.id);
          setProfilePic(path);
          setUploadError(null);
          setPreview(null);
          setShowCropper(false);
          setIsUploadModalOpen(false);
          if (onProfileUpdate) {
            onProfileUpdate({ profile_pic: path });
          }
          resolve();
          return;
        }
        if (xhr.status === 422 && parsed.nsfw) {
          setUploadError(UPLOAD_MSG_NSFW);
        } else {
          setUploadError(UPLOAD_MSG_TRY_AGAIN);
        }
        if (onProgress) onProgress(0);
        reject(new Error("upload"));
      };

      xhr.onerror = () => {
        setUploadError(UPLOAD_MSG_TRY_AGAIN);
        if (onProgress) onProgress(0);
        reject(new Error("network"));
      };

      xhr.open("POST", "/api/upload/profilepic", true);
      xhr.withCredentials = true;
      xhr.send(formData);
    }).finally(() => {
      setIsUploading(false);
    });
  };

  const handleCrop = async (croppedFile: File, onProgress?: (progress: number) => void) => {
    await handleDirectUpload(croppedFile, onProgress);
  };

  // Avatar click always opens the full preview (owners + viewers). Owners can
  // still change the pic via the camera button overlay on the avatar.
  const handleAvatarClick = () => {
    if (profilePic) {
      setIsPreviewModalOpen(true);
    } else if (isOwner && !isUploading) {
      // No pic yet  go straight to upload.
      setIsUploadModalOpen(true);
    }
  };

  const handleEditAvatarClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isUploading) {
      setIsUploadModalOpen(true);
    }
  };

  const handleModalClose = () => {
    if (!isUploading) {
      setIsUploadModalOpen(false);
      setPreview(null);
      setShowCropper(false);
      setUploadError(null);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const subscriberCount = channelStats?.subscriber_count ?? 0;
  const subscriptionCount = channelStats?.subscription_count ?? 0;

  return (
    <div className="mb-8">
      {/* Profile card */}
      <div className="flex flex-col items-center pt-8 pb-6 px-4">
        {/* Avatar */}
        <div className="relative group mb-5">
          <Avatar
            className={`h-28 w-28 sm:h-36 sm:w-36 ring-4 ring-background shadow-xl cursor-pointer hover:opacity-90 transition-all duration-200 ${
              profilePic ? '' : 'pointer-events-none'
            }`}
            onClick={handleAvatarClick}
          >
            <AvatarImage
              src={getProfilePicUrl(profilePic, avatarCacheKey)}
              alt={profile.username}
              className="object-cover"
            />
            <AvatarFallback className="text-3xl sm:text-4xl font-bold bg-primary/10 text-primary">
              {profile.username.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {isOwner && (
            <button
              onClick={handleEditAvatarClick}
              aria-label="Change profile picture"
              className="absolute bottom-0 right-0 w-9 h-9 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors border-2 border-background"
            >
              <Camera className="h-4 w-4" />
            </button>
          )}
          {profilePic && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              <span className="text-white text-xs font-medium">View</span>
            </div>
          )}
        </div>

        {/* Name + bio */}
        <div className="text-center max-w-xl space-y-2 mb-5">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
            {profile.username}
          </h1>
          <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" />
            <span>Joined {formatDistanceToNow(new Date(profile.created_at), { addSuffix: true })}</span>
          </div>
          {profile.about && (
            <p className="text-sm text-muted-foreground leading-relaxed pt-1 max-w-md mx-auto">
              {profile.about}
            </p>
          )}
        </div>

        {/* Stats row */}
        <div className="flex items-center justify-center divide-x divide-border mb-5">
          <StatItem value={formatSubscriberCount(subscriberCount)} label="Subscribers" />
          <StatItem value={formatSubscriberCount(subscriptionCount)} label="Subscriptions" />
          <StatItem value={profile.file_count || 0} label="Uploads" />
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2.5">
          {!isOwner && (
            <SubscribeButton
              channelId={profile.id}
              currentUserId={currentUserId ?? null}
              initialSubscribed={channelStats?.is_subscribed ?? false}
              initialNotify={channelStats?.notify ?? false}
              initialCount={subscriberCount}
            />
          )}
          {isOwner && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditOpen(true)}
              className="gap-2 rounded-full px-4 h-9"
            >
              <Edit2 className="h-3.5 w-3.5" />
              Edit Profile
            </Button>
          )}
        </div>
      </div>

      {/* Modals */}
      {isOwner && (
        <>
          <EditProfileDialog
            profile={profile}
            isOpen={isEditOpen}
            onClose={() => setIsEditOpen(false)}
          />
          <Dialog open={isUploadModalOpen} onOpenChange={handleModalClose}>
            <DialogContent className="w-[95vw] max-w-4xl max-h-[95vh] p-0 gap-0 flex flex-col">
              <DialogHeader className="px-4 sm:px-6 pt-4 sm:pt-6 pb-3 sm:pb-4 border-b flex-shrink-0 bg-background sticky top-0 z-10">
                <DialogTitle className="text-lg sm:text-xl font-semibold">Change Profile Picture</DialogTitle>
                <DialogDescription className="sr-only">Change profile picture</DialogDescription>
              </DialogHeader>
              <div className="px-4 sm:px-6 py-4 space-y-4 overflow-y-auto flex-1" style={{ maxHeight: uploadError ? 'calc(95vh - 250px)' : 'calc(95vh - 180px)' }}>
                {showCropper && preview ? (
                  <ImageCropper
                    imageSrc={preview}
                    onCrop={handleCrop}
                    onCancel={() => {
                      if (!isUploading) {
                        setShowCropper(false);
                        setPreview(null);
                        setSelectedFile(null);
                        setUploadError(null);
                        if (fileInputRef.current) {
                          fileInputRef.current.value = '';
                        }
                      }
                    }}
                    isUploading={isUploading}
                  />
                ) : (
                  <>
                    <div className="flex flex-col items-center space-y-4">
                      <div className="relative">
                        <Avatar className="h-32 w-32 border-2 border-border">
                          <AvatarImage
                            src={preview || getProfilePicUrl(profilePic, avatarCacheKey)}
                            alt="Preview"
                            className="object-cover"
                          />
                          <AvatarFallback className="text-2xl">
                            {profile.username.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                      <Button
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                        className="w-full"
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        Choose Image
                      </Button>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="outline"
                        onClick={handleModalClose}
                        disabled={isUploading}
                      >
                        Cancel
                      </Button>
                    </div>
                  </>
                )}
              </div>
              {uploadError && (
                <div className="px-4 sm:px-6 py-3 sm:py-4 border-t flex-shrink-0 bg-background bottom-0 z-10">
                  <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                    <p className="text-sm text-destructive font-medium text-center">
                      {uploadError}
                    </p>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </>
      )}
      {profilePic && (
        <ImgPreview
          images={[getProfilePicUrl(profilePic, avatarCacheKey) || ""]}
          index={0}
          isOpen={isPreviewModalOpen}
          setIsOpen={setIsPreviewModalOpen}
        />
      )}
    </div>
  );
};

export default UserProfileHeader;
