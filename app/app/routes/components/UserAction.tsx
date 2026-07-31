import { ThumbsUp, ThumbsDown, Share2, Download, MoreHorizontal, Link2, Bookmark } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { useState, useCallback, useEffect } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "~/components/ui/dropdown-menu";
import { ShareModal } from "~/components/ShareModal";
import { BASE_URL } from "~/lib/URLS";
import { toast } from "~/components/ui/sonner";
import { personalizationService } from "~/lib/Services/PersonalizationService";

function formatCompact(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

interface UserActionProps {
  upCount?: number;
  downCount?: number;
  fileId?: string;
  initialLiked?: boolean;
  initialDisliked?: boolean;
  canDownload?: boolean;
  isReel?: boolean;
  reelId?: string;
  variant?: "default" | "pill";
}

const UserAction = ({ upCount = 0, downCount = 0, fileId, initialLiked = false, initialDisliked = false, canDownload = false, isReel = false, reelId, variant = "default" }: UserActionProps) => {
  const [liked, setLiked] = useState(initialLiked);
  const [disliked, setDisliked] = useState(initialDisliked);
  const [displayUpCount, setDisplayUpCount] = useState(upCount);
  const [displayDownCount, setDisplayDownCount] = useState(downCount);
  const [isLoading, setIsLoading] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);

  useEffect(() => {
    setLiked(initialLiked);
    setDisliked(initialDisliked);
    setDisplayUpCount(upCount);
    setDisplayDownCount(downCount);
  }, [initialLiked, initialDisliked, upCount, downCount]);

  const handleLike = useCallback(async () => {
    const targetFileId = (isReel && reelId) ? reelId : fileId;
    if (!targetFileId || isLoading) return;
    const wasLiked = liked;
    const wasDisliked = disliked;
    setLiked(!wasLiked);
    setDisplayUpCount((c) => (wasLiked ? Math.max(0, c - 1) : c + 1));
    if (wasDisliked) {
      setDisliked(false);
      setDisplayDownCount((c) => Math.max(0, c - 1));
    }
    setIsLoading(true);
    try {
      const res = await fetch('/api/likes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: targetFileId }) });
      if (res.status === 401) { window.location.href = '/auth/login'; return; }
      const result = await res.json();
      if (result.success) {
        setLiked(result.liked);
        setDisliked(result.disliked);
        setDisplayUpCount(result.like_count ?? 0);
        setDisplayDownCount(result.dislike_count ?? 0);
        // Steer the in-session feed toward what the user just liked.
        if (result.liked && Array.isArray(result.categories)) {
          personalizationService.trackSessionLike(result.categories);
        }
      } else {
        setLiked(wasLiked);
        setDisliked(wasDisliked);
        setDisplayUpCount(upCount);
        setDisplayDownCount(downCount);
        toast.error("Couldn't update your like. Try again.");
      }
    } catch {
      setLiked(wasLiked);
      setDisliked(wasDisliked);
      setDisplayUpCount(upCount);
      setDisplayDownCount(downCount);
      toast.error("Couldn't update your like. Try again.");
    } finally {
      setIsLoading(false);
    }
  }, [liked, disliked, fileId, upCount, downCount, isReel, reelId, isLoading]);

  const handleDislike = useCallback(async () => {
    const targetFileId = (isReel && reelId) ? reelId : fileId;
    if (!targetFileId || isLoading) return;
    const wasLiked = liked;
    const wasDisliked = disliked;
    setDisliked(!wasDisliked);
    setDisplayDownCount((c) => (wasDisliked ? Math.max(0, c - 1) : c + 1));
    if (wasLiked) {
      setLiked(false);
      setDisplayUpCount((c) => Math.max(0, c - 1));
    }
    setIsLoading(true);
    try {
      const res = await fetch('/api/dislikes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: targetFileId }) });
      if (res.status === 401) { window.location.href = '/auth/login'; return; }
      const result = await res.json();
      if (result.success) {
        setLiked(result.liked);
        setDisliked(result.disliked);
        setDisplayUpCount(result.like_count ?? 0);
        setDisplayDownCount(result.dislike_count ?? 0);
      } else {
        setLiked(wasLiked);
        setDisliked(wasDisliked);
        setDisplayUpCount(upCount);
        setDisplayDownCount(downCount);
        toast.error("Couldn't update your reaction. Try again.");
      }
    } catch {
      setLiked(wasLiked);
      setDisliked(wasDisliked);
      setDisplayUpCount(upCount);
      setDisplayDownCount(downCount);
      toast.error("Couldn't update your reaction. Try again.");
    } finally {
      setIsLoading(false);
    }
  }, [liked, disliked, fileId, upCount, downCount, isReel, reelId, isLoading]);

  const shareId = (isReel && reelId) ? reelId : fileId;
  const shareUrl = !shareId ? (typeof window !== "undefined" ? window.location.href : BASE_URL) : `${BASE_URL}/${isReel ? "reel/" : ""}${shareId}`;
  const handleShare = () => setShareModalOpen(true);

  if (isReel) {
    const targetFileId = (isReel && reelId) ? reelId : fileId;

    return (
      <div className="flex flex-col items-center gap-4 text-white sm:gap-5 z-[1000]">
        <button
          type="button"
          onClick={handleLike}
          disabled={isLoading || !targetFileId}
          aria-label={liked ? 'Remove like' : 'Like'}
          aria-pressed={liked}
          className={`flex flex-col items-center gap-1 rounded-full p-1.5 transition ${
            liked ? 'text-primary' : 'text-white/90 hover:text-white'
          }`}
        >
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/60 shadow-md backdrop-blur-md sm:h-11 sm:w-11">
            <ThumbsUp className={`h-4 w-4 sm:h-5 sm:w-5 ${liked ? 'fill-current' : ''}`} />
          </div>
          <span className="text-[10px] sm:text-[11px] font-medium tabular-nums">
            {displayUpCount.toLocaleString('en-US')}
          </span>
        </button>

        <button
          type="button"
          onClick={handleDislike}
          disabled={isLoading || !targetFileId}
          aria-label={disliked ? 'Remove dislike' : 'Dislike'}
          aria-pressed={disliked}
          className={`flex flex-col items-center gap-1 rounded-full p-1.5 transition ${
            disliked ? 'text-destructive' : 'text-white/90 hover:text-white'
          }`}
        >
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/60 shadow-md backdrop-blur-md sm:h-11 sm:w-11">
            <ThumbsDown className={`h-4 w-4 sm:h-5 sm:w-5 ${disliked ? 'fill-current' : ''}`} />
          </div>
          <span className="text-[10px] sm:text-[11px] font-medium tabular-nums">
            {displayDownCount.toLocaleString('en-US')}
          </span>
        </button>

        <button
          type="button"
          onClick={handleShare}
          aria-label="Share"
          className="flex flex-col items-center gap-1 text-white/90 hover:text-white"
        >
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/60 shadow-md backdrop-blur-md sm:h-11 sm:w-11">
            <Share2 className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
          <span className="text-[10px] sm:text-[11px] font-medium tabular-nums">
            Share
          </span>
        </button>
        <ShareModal open={shareModalOpen} onOpenChange={setShareModalOpen} shareUrl={shareUrl} />
      </div>
    );
  }

  if (variant === "pill") {
    const pillClass = "rounded-full bg-zinc-800 hover:bg-zinc-700 text-white border-0 h-9 px-4 flex items-center gap-2 text-sm font-medium transition-colors";
    const likeDislikePill = (
      <div className="flex items-stretch rounded-full bg-zinc-800 overflow-hidden border border-zinc-700/50">
        <button
          type="button"
          onClick={handleLike}
          disabled={isLoading || !fileId}
          className={`flex items-center gap-2 pl-4 pr-3 py-2 transition-colors ${liked ? "text-primary" : "text-white hover:bg-zinc-700"}`}
        >
          <ThumbsUp className={`h-4 w-4 ${liked ? "fill-current" : ""}`} />
          <span className="tabular-nums">{displayUpCount > 0 ? formatCompact(displayUpCount) : ""}</span>
        </button>
        <div className="w-px bg-white/20 shrink-0" aria-hidden />
        <button
          type="button"
          onClick={handleDislike}
          disabled={isLoading || !fileId}
          className={`flex items-center justify-center p-2 transition-colors ${disliked ? "text-primary" : "text-white hover:bg-zinc-700"}`}
        >
          <ThumbsDown className={`h-4 w-4 ${disliked ? "fill-current" : ""}`} />
        </button>
      </div>
    );
    return (
      <div className="flex flex-wrap items-center gap-2">
        {likeDislikePill}
        <button type="button" onClick={handleShare} className={pillClass}>
          <Share2 className="h-4 w-4" />
          Share
        </button>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(window.location.href).catch(() => {})}
          className={pillClass}
        >
          <Bookmark className="h-4 w-4" />
          Save
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="rounded-full h-9 w-9 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-white border-0 transition-colors">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 space-y-1">
            <DropdownMenuItem className="gap-2 cursor-pointer" onSelect={(e) => { e.preventDefault(); navigator.clipboard.writeText(window.location.href).catch(() => {}); }}>
              <Link2 className="h-4 w-4" />
              <span className="text-sm">Copy link</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ShareModal open={shareModalOpen} onOpenChange={setShareModalOpen} shareUrl={shareUrl} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLike}
          disabled={isLoading || !fileId}
          className={`gap-2 ${liked ? 'bg-primary/10 text-primary' : ''}`}
        >
          <ThumbsUp className={`h-4 w-4 ${liked ? 'fill-current' : ''}`} />
          <span className="text-sm font-medium">{displayUpCount}</span>
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleDislike}
          disabled={isLoading || !fileId}
          className={`gap-2 ${disliked ? 'bg-destructive/10 text-destructive' : ''}`}
        >
          <ThumbsDown className={`h-4 w-4 ${disliked ? 'fill-current' : ''}`} />
          <span className="text-sm font-medium">{displayDownCount}</span>
        </Button>

        <Separator orientation="vertical" className="h-6" />

        <Button
          variant="ghost"
          size="sm"
          onClick={handleShare}
          className="gap-2"
        >
          <Share2 className="h-4 w-4" />
          <span className="text-sm font-medium">Share</span>
        </Button>

        {/* Download UI removed with the download endpoints (downloadPolicy.server.ts).
            The component and queue are kept for the future authenticated
            download flow; nothing renders them today. */}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 space-y-1">
            <DropdownMenuItem
              className="gap-2 cursor-pointer"
              onSelect={(event) => {
                event.preventDefault();
                const url = window.location.href;
                navigator.clipboard.writeText(url).catch(() => {});
              }}
            >
              <Link2 className="h-4 w-4" />
              <span className="text-sm">Copy link</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ShareModal open={shareModalOpen} onOpenChange={setShareModalOpen} shareUrl={shareUrl} />
      </div>
    </div>
  );
};

export default UserAction;
