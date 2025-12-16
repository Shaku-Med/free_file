import { ThumbsUp, ThumbsDown, Share2, Download, MoreHorizontal, Link2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { useState, useCallback, useRef, useEffect } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "~/components/ui/dropdown-menu";
import DownloadButton from "~/routes/Dynamic/components/DownloadButton";

interface UserActionProps {
  upCount?: number;
  downCount?: number;
  fileId?: string;
  initialLiked?: boolean;
  initialDisliked?: boolean;
  canDownload?: boolean;
}

const UserAction = ({ upCount = 0, downCount = 0, fileId, initialLiked = false, initialDisliked = false, canDownload = false }: UserActionProps) => {
  const [liked, setLiked] = useState(initialLiked);
  const [disliked, setDisliked] = useState(initialDisliked);
  const [displayUpCount, setDisplayUpCount] = useState(upCount);
  const [displayDownCount, setDisplayDownCount] = useState(downCount);
  const [isLoading, setIsLoading] = useState(false);

  const likeDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const dislikeDebounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setLiked(initialLiked);
    setDisliked(initialDisliked);
    setDisplayUpCount(upCount);
    setDisplayDownCount(downCount);
  }, [initialLiked, initialDisliked, upCount, downCount]);

  const handleLike = useCallback(() => {
    if (!fileId) return;

    const wasLiked = liked;
    const wasDisliked = disliked;

    if (wasDisliked) {
      setDisliked(false);
      setDisplayDownCount(prev => Math.max(0, prev - 1));
    }

    const newLiked = !wasLiked;
    setLiked(newLiked);
    setDisplayUpCount(prev => newLiked ? prev + 1 : Math.max(0, prev - 1));

    if (likeDebounceRef.current) {
      clearTimeout(likeDebounceRef.current);
    }

    likeDebounceRef.current = setTimeout(async () => {
      setIsLoading(true);
      try {
        const method = newLiked ? 'POST' : 'DELETE';
        const response = await fetch('/api/likes', {
          method,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fileId }),
        });

        if (!response.ok) {
          if (response.status === 401) {
            window.location.href = '/auth/login';
            return;
          }
          const error = await response.json();
          throw new Error(error.error || 'Failed to update like');
        }

        const result = await response.json();
        if (result.success && result.upCount !== undefined && result.downCount !== undefined) {
          setDisplayUpCount(result.upCount);
          setDisplayDownCount(result.downCount);
        }
      } catch (error) {
        console.error('Error updating like:', error);
        setLiked(wasLiked);
        setDisliked(wasDisliked);
        setDisplayUpCount(upCount);
        setDisplayDownCount(downCount);
      } finally {
        setIsLoading(false);
      }
    }, 500);
  }, [liked, disliked, fileId, upCount, downCount]);

  const handleDislike = useCallback(() => {
    if (!fileId) return;

    const wasLiked = liked;
    const wasDisliked = disliked;

    if (wasLiked) {
      setLiked(false);
      setDisplayUpCount(prev => Math.max(0, prev - 1));
    }

    const newDisliked = !wasDisliked;
    setDisliked(newDisliked);
    setDisplayDownCount(prev => newDisliked ? prev + 1 : Math.max(0, prev - 1));

    if (dislikeDebounceRef.current) {
      clearTimeout(dislikeDebounceRef.current);
    }

    dislikeDebounceRef.current = setTimeout(async () => {
      setIsLoading(true);
      try {
        const method = newDisliked ? 'POST' : 'DELETE';
        const response = await fetch('/api/dislikes', {
          method,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fileId }),
        });

        if (!response.ok) {
          if (response.status === 401) {
            window.location.href = '/auth/login';
            return;
          }
          const error = await response.json();
          throw new Error(error.error || 'Failed to update dislike');
        }

        const result = await response.json();
        if (result.success && result.upCount !== undefined && result.downCount !== undefined) {
          setDisplayUpCount(result.upCount);
          setDisplayDownCount(result.downCount);
        }
      } catch (error) {
        console.error('Error updating dislike:', error);
        setLiked(wasLiked);
        setDisliked(wasDisliked);
        setDisplayUpCount(upCount);
        setDisplayDownCount(downCount);
      } finally {
        setIsLoading(false);
      }
    }, 500);
  }, [liked, disliked, fileId, upCount, downCount]);

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: document.title,
        url: window.location.href,
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(window.location.href).catch(() => {});
    }
  };

  useEffect(() => {
    return () => {
      if (likeDebounceRef.current) {
        clearTimeout(likeDebounceRef.current);
      }
      if (dislikeDebounceRef.current) {
        clearTimeout(dislikeDebounceRef.current);
      }
    };
  }, []);

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

        {fileId && canDownload && (
          <div className="w-32">
            <DownloadButton fileId={fileId} />
          </div>
        )}

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
      </div>
    </div>
  );
};

export default UserAction;
