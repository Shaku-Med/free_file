import { useState, useCallback, useEffect } from "react";
import { Link } from "react-router";
import type { FileType } from "~/lib/types";
import { getThumbnailUrl, ParseFilename } from "~/lib/utils";
import ImageLoad from "~/routes/Home/components/ImageLoad/ImageLoad";
import AdultContentBadge from "./AdultContentBadge";
import OwnerProfile from "~/components/OwnerProfile/OwnerProfile";
import Actions from "~/routes/Home/components/VideoCard/Actions";
import { Separator } from "~/components/ui/separator";
import CategoryBadges from "~/components/CategoryBadges";
import { Info } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

function getMetadataWarning(metadata: unknown): string | null {
  if (metadata && typeof metadata === "object" && "warning" in metadata) {
    const w = (metadata as Record<string, unknown>).warning;
    return typeof w === "string" && w.trim() ? w : null;
  }
  return null;
}

interface RelatedVideoCardProps {
  data: FileType;
  currentUserId?: string;
  userActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
}

function formatViews(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
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

const RelatedVideoCard = ({ data, currentUserId, userActions }: RelatedVideoCardProps) => {
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [infoModalOpen, setInfoModalOpen] = useState(false);
  const [liked, setLiked] = useState(userActions?.likedFileIds?.has(data.id) ?? false);
  const [disliked, setDisliked] = useState(userActions?.dislikedFileIds?.has(data.id) ?? false);
  const [likeCount, setLikeCount] = useState(Number(data.like_count ?? data.up_count) || 0);
  const [dislikeCount, setDislikeCount] = useState(Number(data.dislike_count ?? data.down_count) || 0);
  const commentCount = Number(data.comment_count) || 0;
  const viewCount = Number(data.view_count ?? data.views) || 0;
  const metadataWarning = getMetadataWarning(data.metadata);

  const isVideo = data.file_type?.includes("video") || data.file_type === "application/vnd.apple.mpegurl" || data.endpoint?.includes(".m3u8");

  const retry = useCallback(() => {
    if (retryAttempt >= 1) return;
    setRetryAttempt((prev) => prev + 1);
  }, [retryAttempt]);

  useEffect(() => {
    if (userActions && data.id) {
      setLiked(userActions.likedFileIds.has(data.id));
      setDisliked(userActions.dislikedFileIds.has(data.id));
    }
  }, [userActions, data.id]);

  const handleInteractionUpdate = (updates: { liked: boolean; disliked: boolean; like_count: number; dislike_count: number }) => {
    setLiked(updates.liked);
    setDisliked(updates.disliked);
    setLikeCount(updates.like_count);
    setDislikeCount(updates.dislike_count);
  };

  const imageLink = getThumbnailUrl(data, { retryAttempt });

  return (
    <div className="block group">
      <Link to={`/${data.unique_id}`}>
        <div className="relative rounded-xl overflow-hidden bg-card aspect-video">
          {data.is_adult && <AdultContentBadge />}
          <ImageLoad
            link={imageLink}
            imageID={data.unique_id}
            retry={retry}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            quality={40}
            hasAdultTag={Boolean(data.is_adult)}
          />
          {isVideo && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="rounded-full bg-black/50 p-2">
                <div className="w-3 h-3 border-l-2 border-t-2 border-white rounded-sm rotate-[-30deg]" />
              </div>
            </div>
          )}
          <CategoryBadges categories={data.categories} max={2} size="sm" />
          {data.duration && data.duration > 0 && (
            <div className="absolute right-2 bottom-2 bg-black/70 backdrop-blur-sm rounded-md px-1.5 py-0.5 text-[11px] font-medium text-white">
              {formatDuration(data.duration)}
            </div>
          )}
        </div>
      </Link>

      <div className="py-2 flex items-start justify-between flex-col">
        <div className="mb-1 flex items-start gap-3">
          {data.owner && (
            <OwnerProfile owner={data.owner} size="sm" className="text-muted-foreground" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <Link to={`/${data.unique_id}`} className="hover:text-primary transition-colors flex-1 min-w-0">
                <p className="text-sm font-medium leading-tight line-clamp-2">
                  {data.file_title || ParseFilename(data.filename)}
                </p>
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
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
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

        <div className="w-full">
          <Separator className="my-2" />
          <Actions
            fileId={data.id}
            uniqueId={data.unique_id}
            likeCount={likeCount}
            dislikeCount={dislikeCount}
            commentCount={commentCount}
            liked={liked}
            disliked={disliked}
            onUpdate={currentUserId ? handleInteractionUpdate : undefined}
            currentUserId={currentUserId}
            isOwner={data.owner?.id === currentUserId}
          />
        </div>
      </div>

      {metadataWarning && (
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
      )}
    </div>
  );
};

export default RelatedVideoCard;
