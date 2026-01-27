import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Calendar, Edit2, Camera, Loader2, Upload, X } from "lucide-react";
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
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";

interface UserProfileHeaderProps {
  profile: UserProfile;
  isOwner: boolean;
  onProfileUpdate?: (updatedProfile: Partial<UserProfile>) => void;
}

const UserProfileHeader = ({ profile, isOwner, onProfileUpdate }: UserProfileHeaderProps) => {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [profilePic, setProfilePic] = useState(profile.profile_pic);
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

    if (!file.type.startsWith('image/')) {
      setUploadError('Please select an image file');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setUploadError('File size must be less than 10MB');
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
        if (xhr.readyState === XMLHttpRequest.DONE) {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const result = JSON.parse(xhr.responseText);
              if (result.success && result.profile_pic) {
                if (onProgress) onProgress(100);
                setProfilePic(result.profile_pic);
                setUploadError(null);
                setPreview(null);
                setShowCropper(false);
                setIsUploadModalOpen(false);
                if (onProfileUpdate) {
                  onProfileUpdate({ profile_pic: result.profile_pic });
                }
                resolve();
              } else {
                throw new Error(result.error || 'Failed to upload profile picture');
              }
            } catch (error: any) {
              reject(error);
            }
          } else {
            try {
              const result = JSON.parse(xhr.responseText);
              const errorMessage = result.error || `Upload failed with status ${xhr.status}`;
              reject(new Error(errorMessage));
            } catch {
              reject(new Error(`Failed to upload profile picture. Status: ${xhr.status}`));
            }
          }
        }
      };

      xhr.onerror = () => {
        reject(new Error('Network error occurred. Please check your connection and try again.'));
      };

      xhr.open('POST', '/api/upload/profilepic', true);
      xhr.send(formData);
    }).catch((error: any) => {
      const errorMessage = error.message || 'Failed to upload profile picture';
      setUploadError(errorMessage);
      if (onProgress) {
        onProgress(0);
      }
    }).finally(() => {
      setIsUploading(false);
    });
  };

  const handleCrop = async (croppedFile: File, onProgress?: (progress: number) => void) => {
    await handleDirectUpload(croppedFile, onProgress);
  };

  const handleAvatarClick = () => {
    if (isOwner && !isUploading) {
      setIsUploadModalOpen(true);
    } else {
      setIsPreviewModalOpen(true);
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

  return (
    <div className="space-y-8 mb-12">
      <div className="flex flex-col items-center justify-center space-y-6">
        <div className="relative group">
          <Avatar 
            className={`h-40 w-40 sm:h-48 sm:w-48 border-4 border-border shadow-lg cursor-pointer hover:opacity-90 transition-opacity ${
              profilePic ? '' : 'pointer-events-none'
            }`}
            onClick={handleAvatarClick}
          >
            <AvatarImage src={getProfilePicUrl(profilePic)} alt={profile.username} className="object-cover" />
            <AvatarFallback className="text-4xl sm:text-5xl">
              {profile.username.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {isOwner && profilePic && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              <Camera className="h-8 w-8 text-white" />
            </div>
          )}
          {!isOwner && profilePic && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              <div className="text-white text-xs font-medium">View</div>
            </div>
          )}
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
                <DialogDescription className="text-xs sm:text-sm text-muted-foreground">
                  {showCropper 
                    ? "Crop your image to a square. Drag to position, pinch/scroll to zoom."
                    : isUploading
                    ? "Uploading your profile picture..."
                    : "Upload a new profile picture. Maximum file size is 10MB. Images must be square (1:1 aspect ratio)."
                  }
                </DialogDescription>
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
                            src={preview || getProfilePicUrl(profilePic)} 
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
      <Dialog open={isPreviewModalOpen} onOpenChange={setIsPreviewModalOpen}>
        <DialogContent className="w-full h-full max-w-none max-h-none p-0 gap-0 bg-black border-none rounded-none m-0">
          <div className="relative w-screen h-screen flex items-center justify-center">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsPreviewModalOpen(false)}
              className="absolute top-4 right-4 z-50 h-10 w-10 rounded-full bg-background/80 hover:bg-background text-foreground"
            >
              <X className="h-5 w-5" />
            </Button>
            {profilePic ? (
              <TransformWrapper
                initialScale={1}
                minScale={0.5}
                maxScale={5}
                centerOnInit
                wheel={{ step: 0.1 }}
                doubleClick={{ disabled: false, step: 0.7 }}
                limitToBounds={false}
              >
                <TransformComponent
                  wrapperStyle={{ width: '100%', height: '100%' }}
                  contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <img
                    src={getProfilePicUrl(profilePic) || ''}
                    alt={profile.username}
                    className="w-auto h-auto max-w-[90vw] max-h-[90vh] object-contain"
                    draggable={false}
                  />
                </TransformComponent>
              </TransformWrapper>
            ) : (
              <div className="flex flex-col items-center justify-center text-muted-foreground">
                <div className="h-32 w-32 rounded-full bg-muted flex items-center justify-center mb-4">
                  <span className="text-6xl font-bold">
                    {profile.username.charAt(0).toUpperCase()}
                  </span>
                </div>
                <p className="text-lg">No profile picture</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserProfileHeader;
