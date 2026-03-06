import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Button } from "~/components/ui/button";
import type { FileType } from "~/lib/types";
import ImageLoad from "./ImageLoad/ImageLoad";
import { arrangeDateForThumbnail, ParseFilename, getRandomThumbnail } from "~/lib/utils";
import ParseFilenameInsert from "~/lib/utils/ShowFileName";
import AdultContentBadge from "~/routes/Dynamic/components/AdultContentBadge";
import OwnerProfile from "~/components/OwnerProfile/OwnerProfile";
import Actions from "./VideoCard/Actions";
import { Separator } from "~/components/ui/separator";
import CategoryBadges from "~/components/CategoryBadges";
import { Info, MoreVertical, Clock, ListVideo, ChevronDown, X, Check } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { useIsMobile } from "~/hooks/use-mobile";
import { useSidebar } from "~/components/ui/sidebar";

function getMetadataWarning(metadata: unknown): string | null {
  if (metadata && typeof metadata === "object" && "warning" in metadata) {
    const w = (metadata as Record<string, unknown>).warning;
    return typeof w === "string" && w.trim() ? w : null;
  }
  return null;
}

function formatViews(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(count);
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatTimeAgo(date: string | Date): string {
  const now = new Date();
  const past = new Date(date);
  const diffInSeconds = Math.floor((now.getTime() - past.getTime()) / 1000);
  
  if (diffInSeconds < 60) return "just now";
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} minutes ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
  if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)} days ago`;
  if (diffInSeconds < 31536000) return `${Math.floor(diffInSeconds / 2592000)} months ago`;
  return `${Math.floor(diffInSeconds / 31536000)} years ago`;
}

type LayoutType = "default" | "horizontal" | "compact";

interface VideoCardProps {
  data: FileType;
  index?: number;
  currentUserId?: string;
  userActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
  onUpdate?: (fileId: string, updates: Partial<FileType>) => void;
  showOwnerControls?: boolean;
  related?: boolean;
  layout?: LayoutType;
}

const CATEGORIES = ["Gaming", "Music", "Entertainment", "Education", "Technology", "Sports", "News", "Lifestyle", "Anime", "Film", "Automotive", "Art", "Nature", "Other"];

const VideoCard = ({ data, index, currentUserId, userActions, onUpdate, showOwnerControls, related, layout = "default" }: VideoCardProps) => {
  const isMobile = useIsMobile();
  const {state} = useSidebar()
  // 
  const [error, setError] = useState<boolean>(false);
  const [retryAttempt, setRetryAttempt] = useState<number>(0);
  const [loaded, setLoaded] = useState<boolean>(false);
  const [liked, setLiked] = useState(userActions?.likedFileIds?.has(data.id) ?? false);
  const [disliked, setDisliked] = useState(userActions?.dislikedFileIds?.has(data.id) ?? false);
  const [likeCount, setLikeCount] = useState(Number(data.like_count ?? data.up_count) || 0);
  const [dislikeCount, setDislikeCount] = useState(Number(data.dislike_count ?? data.down_count) || 0);
  const uploadStatus = data.upload_status || "completed";
  const hasEndpoint = Boolean(data.endpoint);
  const isOwner = Boolean(currentUserId && data.owner_id && currentUserId === data.owner_id);
  const isPending = uploadStatus !== "completed" && !hasEndpoint;
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(data.file_title || "");
  const [editDescription, setEditDescription] = useState(data.file_description || "");
  const [editIsPublic, setEditIsPublic] = useState(Boolean(data.is_public));
  const [editCategories, setEditCategories] = useState<string[]>(() => {
    if (Array.isArray(data.categories)) return data.categories.filter((c): c is string => typeof c === "string");
    return [];
  });
  const [editTags, setEditTags] = useState<string[]>(() => {
    if (Array.isArray(data.tags)) return data.tags.filter((t): t is string => typeof t === "string");
    return [];
  });
  const [tagInput, setTagInput] = useState("");
  const [catDropdownOpen, setCatDropdownOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [infoModalOpen, setInfoModalOpen] = useState(false);
  
  const catDropdownRef = useRef<HTMLDivElement>(null);

  const nav = useNavigate();
  const metadataWarning = getMetadataWarning(data.metadata);
  const commentCount = Number(data.comment_count) || 0;
  const viewCount = Number(data.view_count ?? data.views) || 0;

  useEffect(() => {
    if (userActions && data.id) {
      setLiked(userActions.likedFileIds.has(data.id));
      setDisliked(userActions.dislikedFileIds.has(data.id));
    }
  }, [userActions, data.id]);

  useEffect(() => {
    setEditTitle(data.file_title || "");
    setEditDescription(data.file_description || "");
    setEditIsPublic(Boolean(data.is_public));
    setEditCategories(Array.isArray(data.categories) ? data.categories.filter((c): c is string => typeof c === "string") : []);
    setEditTags(Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === "string") : []);
  }, [data.file_title, data.file_description, data.is_public, data.categories, data.tags]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (catDropdownRef.current && !catDropdownRef.current.contains(event.target as Node)) {
        setCatDropdownOpen(false);
      }
    };

    if (catDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [catDropdownOpen]);

  const handleInteractionUpdate = (updates: { liked: boolean; disliked: boolean; like_count: number; dislike_count: number }) => {
    setLiked(updates.liked);
    setDisliked(updates.disliked);
    setLikeCount(updates.like_count);
    setDislikeCount(updates.dislike_count);
  };

  const handleSave = async () => {
    if (!data.id) {
      setEditError("Missing file id.");
      return;
    }
    setIsSaving(true);
    setEditError(null);
    try {
      const response = await fetch("/api/files", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: data.id || data.unique_id,
          title: editTitle,
          description: editDescription,
          isPublic: editIsPublic,
          categories: editCategories,
          tags: editTags,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setEditError(payload?.error || "Failed to update file.");
        return;
      }

      const payload = await response.json().catch(() => null);
      if (payload?.file && onUpdate) {
        onUpdate(data.id, {
          file_title: payload.file.file_title ?? editTitle,
          file_description: payload.file.file_description ?? editDescription,
          is_public: payload.file.is_public ?? editIsPublic,
          categories: payload.file.categories ?? editCategories,
          tags: payload.file.tags ?? editTags,
        });
      }
      setIsEditing(false);
    } catch {
      setEditError("Failed to update file.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCategoryToggle = (cat: string) => {
    if (isSaving) return;
    setEditCategories((prev) => 
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleRemoveCategory = (cat: string) => {
    if (isSaving) return;
    setEditCategories((prev) => prev.filter((c) => c !== cat));
  };

  const handleRemoveTag = (index: number) => {
    if (isSaving) return;
    setEditTags((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
      e.preventDefault();
      const val = tagInput.trim().slice(0, 50);
      if (val && editTags.length < 15 && !editTags.includes(val)) {
        setEditTags((prev) => [...prev, val]);
      }
      setTagInput("");
    }
    if (e.key === "Backspace" && !tagInput && editTags.length > 0) {
      setEditTags((prev) => prev.slice(0, -1));
    }
  };

  const getThumbnailLink = () => {
    if (data.file_type.startsWith("image/") && data.endpoint) {
      return `/api/load/image/${data.endpoint}`;
    }
    const thumbnailsNoPreview = (data.thumbnails || []).filter(
      (t): t is string => typeof t === "string" && !t.includes("thumbnail_preview")
    );
    const randomThumbnail = getRandomThumbnail(thumbnailsNoPreview.length ? thumbnailsNoPreview : undefined);
    if (randomThumbnail) {
      return `/api/load/image/${randomThumbnail}`;
    }
    return `/api/load/image/${arrangeDateForThumbnail(data.created_at, retryAttempt)}/${data.unique_id}/thumbnail_${ParseFilename(data.filename)}.jpg`;
  };

  const renderThumbnail = (className?: string) => (
    <div className={`relative ${className || ""}`}>
      {data.is_adult && <AdultContentBadge />}
      <motion.div
        transition={{ duration: 0.1, ease: "easeOut", damping: 10, stiffness: 100 }}
        className="w-full h-full"
      >
        {!error && !isPending ? (
          <ImageLoad
            link={getThumbnailLink()}
            imageID={data.unique_id}
            index={index}
            retry={() => {
              if (retryAttempt >= 1) {
                setError(true);
                return;
              }
              setRetryAttempt((prev) => prev + 1);
            }}
            className="w-full h-full object-cover transition-all duration-300"
            callBack={(e) => {
              if (e) setLoaded(true);
            }}
            quality={40}
            hasAdultTag={Boolean(data.is_adult)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted text-xs text-center">
            <span>{isPending ? "Processing upload..." : "Failed to load image"}</span>
          </div>
        )}
        {layout === "default" && <CategoryBadges categories={data.categories} />}
        {data.duration && data.duration > 0 && (
          <div className="file_duration flex items-center absolute right-2 shadow-md border backdrop-blur-lg bottom-1 bg-card/50 rounded-lg px-2 py-1 text-xs font-medium">
            <span>{formatDuration(data.duration)}</span>
          </div>
        )}
      </motion.div>
    </div>
  );

  const renderEditDialog = () => (
    <Dialog open={isEditing} onOpenChange={(open) => {
      if (!isSaving) {
        setIsEditing(open);
        if (!open) {
          setCatDropdownOpen(false);
        }
      }
    }}>
      <DialogContent className="w-full rounded-2xl max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>Edit upload</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 overflow-y-auto flex-1 pr-1">
          <div className="space-y-1">
            <p className="text-xs font-medium text-foreground">Title</p>
            <Input 
              value={editTitle} 
              onChange={(e) => setEditTitle(e.target.value)} 
              maxLength={200} 
              disabled={isSaving} 
            />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-foreground">Description</p>
            <Textarea 
              value={editDescription} 
              onChange={(e) => setEditDescription(e.target.value)} 
              rows={3} 
              maxLength={5000} 
              disabled={isSaving} 
            />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Visibility</p>
            <div className="flex items-center gap-2">
              <Button 
                type="button" 
                variant={editIsPublic ? "default" : "outline"} 
                className="rounded-full px-4" 
                onClick={() => setEditIsPublic(true)} 
                disabled={isSaving}
              >
                Public
              </Button>
              <Button 
                type="button" 
                variant={!editIsPublic ? "default" : "outline"} 
                className="rounded-full px-4" 
                onClick={() => setEditIsPublic(false)} 
                disabled={isSaving}
              >
                Private
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Categories</p>
            {editCategories.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {editCategories.map((cat) => (
                  <span 
                    key={cat} 
                    className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs font-medium px-2 py-1 rounded-full"
                  >
                    {cat}
                    <button 
                      type="button" 
                      onClick={() => handleRemoveCategory(cat)} 
                      className="hover:text-destructive transition-colors"
                      disabled={isSaving}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative" ref={catDropdownRef}>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setCatDropdownOpen((prev) => !prev)}
                className="w-full flex items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors"
              >
                <span>Select categories...</span>
                <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${catDropdownOpen ? "rotate-180" : ""}`} />
              </button>
              {catDropdownOpen && (
                <div className="absolute z-[100] mt-1 w-full max-h-48 overflow-y-auto rounded-md border bg-popover shadow-lg">
                  {CATEGORIES.map((cat) => {
                    const selected = editCategories.includes(cat);
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => handleCategoryToggle(cat)}
                        disabled={isSaving}
                        className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-accent flex items-center gap-2 ${selected ? "bg-primary/10 text-primary font-medium" : "text-foreground"}`}
                      >
                        <span className={`w-4 h-4 rounded border flex items-center justify-center text-xs shrink-0 ${selected ? "bg-primary border-primary text-primary-foreground" : "border-input"}`}>
                          {selected && <Check className="w-3 h-3" />}
                        </span>
                        {cat}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-foreground">Tags</p>
              <p className="text-xs text-muted-foreground">{editTags.length}/15</p>
            </div>
            {editTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {editTags.map((tag, i) => (
                  <span 
                    key={`${tag}-${i}`} 
                    className="inline-flex items-center gap-1 bg-muted text-foreground text-xs px-2 py-1 rounded-full"
                  >
                    {tag}
                    <button 
                      type="button" 
                      onClick={() => handleRemoveTag(i)} 
                      className="hover:text-destructive transition-colors"
                      disabled={isSaving}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              placeholder="Type a tag and press Enter..."
              maxLength={50}
              disabled={isSaving || editTags.length >= 15}
            />
          </div>
          {editError && <p className="text-xs text-destructive">{editError}</p>}
        </div>
        <DialogFooter className="gap-2 shrink-0 border-t pt-4">
          <Button 
            type="button" 
            variant="ghost" 
            onClick={() => {
              setIsEditing(false);
              setCatDropdownOpen(false);
            }} 
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const renderInfoDialog = () => (
    metadataWarning && (
      <Dialog open={infoModalOpen} onOpenChange={setInfoModalOpen}>
        <DialogContent className="rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="size-5 text-muted-foreground" />
              Content information
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{metadataWarning}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setInfoModalOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  );

  if (layout === "horizontal") {
    return (
      <div className={`flex ${(state === 'expanded') ? `fl_break_layout text-sm` : `flex-col md:flex-row flex-wrap` } gap-3 p-2 rounded-xl hover:bg-muted/50 transition-colors w-full`}>
        <Link
          onClick={(e) => {
            e.preventDefault();
            nav(`/${data.unique_id}`);
          }}
          to={`/${data.unique_id}`}
          className="shrink-0 w-full min-w-40 max-w-40 md:max-w-44 aspect-video bg-card rounded-xl overflow-hidden relative flex-1"
        >
          {renderThumbnail("w-full h-full aspect-video")}
          <div className="absolute top-2 right-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
              type="button"
              className="p-1.5 bg-black/70 rounded-full hover:bg-black/90 transition-colors"
              onClick={(e) => e.preventDefault()}
            >
              <Clock className="size-4 text-white" />
            </button>
            <button 
              type="button"
              className="p-1.5 bg-black/70 rounded-full hover:bg-black/90 transition-colors"
              onClick={(e) => e.preventDefault()}
            >
              <ListVideo className="size-4 text-white" />
            </button>
          </div>
        </Link>

        <div className="flex-1 min-w-0 flex flex-col justify-center py-0.5 w-full">
          <div className="flex items-start justify-between gap-2">
            <Link to={`/${data.unique_id}`} className="hover:text-primary transition-colors flex-1 min-w-0">
              <h3 className="text-sm font-semibold leading-tight line-clamp-2">
                <ParseFilenameInsert filename={data.file_title || data.filename} showLimit={60} />
              </h3>
            </Link>
          </div>
          
          {data.owner && (
            <Link to={`/profile/${data.owner.username}`} className="text-xs text-muted-foreground hover:text-foreground transition-colors mt-1 block w-fit">
              {data.owner.username}
            </Link>
          )}
          
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
            {viewCount > 0 && <span>{formatViews(viewCount)} views</span>}
            {viewCount > 0 && data.created_at && <span>·</span>}
            {data.created_at && <span>{formatTimeAgo(data.created_at)}</span>}
          </div>

          <div className="w-full">
            <Separator className="my-1" />
            <Actions
              fileId={data.id}
              uniqueId={data.unique_id}
              likeCount={likeCount}
              dislikeCount={dislikeCount}
              commentCount={commentCount}
              liked={liked}
              disliked={disliked}
              isOwner={isOwner}
              onEdit={isOwner ? () => setIsEditing(true) : undefined}
              onUpdate={currentUserId ? handleInteractionUpdate : undefined}
            />
          </div>
        </div>

        {renderEditDialog()}
        {renderInfoDialog()}
      </div>
    );
  }

  if (layout === "compact") {
    return (
      <div className="group flex gap-2 p-1.5 rounded-lg hover:bg-muted/50 transition-colors">
        <Link
          onClick={(e) => {
            e.preventDefault();
            nav(`/${data.unique_id}`);
          }}
          to={`/${data.unique_id}`}
          className="shrink-0 w-24 aspect-video bg-card rounded-lg overflow-hidden relative"
        >
          {renderThumbnail("w-full h-full")}
        </Link>

        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <Link to={`/${data.unique_id}`} className="hover:text-primary transition-colors">
            <h3 className="text-xs font-medium leading-tight line-clamp-2">
              <ParseFilenameInsert filename={data.file_title || data.filename} showLimit={40} />
            </h3>
          </Link>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
            {data.owner && (
              <span className="truncate max-w-[80px]">{data.owner.username}</span>
            )}
            {data.owner && viewCount > 0 && <span>·</span>}
            {viewCount > 0 && <span>{formatViews(viewCount)}</span>}
          </div>
        </div>

        {renderEditDialog()}
        {renderInfoDialog()}
      </div>
    );
  }

  return (
    <div className="item group rounded-2xl relative flex flex-col py-4 h-full">
      <Link
        onClick={(e) => {
          e.preventDefault();
          nav(`/${data.unique_id}`);
        }}
        to={`/${data.unique_id}`}
        className="w-full bg-card rounded-2xl overflow-hidden relative aspect-video group-hover:z-[1000000] z-[10]"
      >
        {renderThumbnail("w-full h-full")}
      </Link>

      <div
        className="hover_overlay pointer-events-none absolute inset-0 z-[10] rounded-2xl bg-muted/50 opacity-0 scale-100 group-hover:z-[100] group-hover:opacity-100 group-hover:scale-105 transition-all duration-300 ease-out"
      />

      <div className="py-2 flex flex-col z-[1000000]">
        <div className="pointer-events-auto mb-1 flex items-start gap-3">
          {data.owner && (
            <OwnerProfile 
              showUsername={false} 
              owner={data.owner} 
              size="sm" 
              className="text-white/90 hover:text-white shrink-0 mt-0.5" 
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-1.5">
              <Link to={`/${data.unique_id}`} className="hover:text-primary transition-colors flex-1 min-w-0">
                <h3 className="text-sm md:text-base font-semibold leading-tight line-clamp-2 h-[2.5rem]">
                  <ParseFilenameInsert filename={data.file_title || data.filename} showLimit={50} />
                </h3>
              </Link>
              {metadataWarning && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setInfoModalOpen(true);
                      }}
                      className="shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                      aria-label="Content information"
                    >
                      <Info className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[200px]">
                    <p>Content information</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground h-[1.25rem]">
              {data.owner && (
                <Link to={`/profile/${data.owner.username}`} className="hover:text-foreground transition-colors truncate max-w-[120px]">
                  {data.owner.username}
                </Link>
              )}
              {data.owner && viewCount > 0 && <span>·</span>}
              {viewCount > 0 && <span>{formatViews(viewCount)} views</span>}
            </div>
          </div>
        </div>

        <div className="ac_dev w-full">
          <Separator className="my-2" />
          <Actions
            fileId={data.id}
            uniqueId={data.unique_id}
            likeCount={likeCount}
            dislikeCount={dislikeCount}
            commentCount={commentCount}
            liked={liked}
            disliked={disliked}
            isOwner={isOwner}
            onEdit={isOwner ? () => setIsEditing(true) : undefined}
            onUpdate={currentUserId ? handleInteractionUpdate : undefined}
          />
        </div>
      </div>

      {renderEditDialog()}
      {renderInfoDialog()}
    </div>
  );
};

export default VideoCard;