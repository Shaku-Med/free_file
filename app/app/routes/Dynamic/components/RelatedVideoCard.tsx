import { useState, useCallback, useRef, useEffect } from "react";
import { Link } from "react-router";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { Button } from "~/components/ui/button";
import type { FileType } from "~/lib/types";
import { ParseFilename, arrangeDateForThumbnail } from "~/lib/utils";
import ImageLoad from "~/routes/Home/components/ImageLoad/ImageLoad";
import AdultContentBadge from "./AdultContentBadge";
import OwnerProfile from "~/components/OwnerProfile/OwnerProfile";

interface RelatedVideoCardProps {
  data: FileType;
  currentUserId?: string;
  userActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
}

const formatFileSize = (size: string | number): string => {
  if (typeof size === 'string') {
    const numSize = parseFloat(size);
    if (isNaN(numSize)) return size;
    size = numSize;
  }
  if (size === 0) return '0 B'
  
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(size) / Math.log(k))
  
  return parseFloat((size / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

const RelatedVideoCard = ({ data, currentUserId, userActions }: RelatedVideoCardProps) => {
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [liked, setLiked] = useState(userActions?.likedFileIds?.has(data.id) || false);
  const [disliked, setDisliked] = useState(userActions?.dislikedFileIds?.has(data.id) || false);
  const [upCount, setUpCount] = useState(Number(data.up_count) || 0);
  const [downCount, setDownCount] = useState(Number(data.down_count) || 0);
  const [isLoading, setIsLoading] = useState(false);

  const isVideo = data.file_type?.includes('video') || data.file_type === 'application/vnd.apple.mpegurl' || data.endpoint?.includes('.m3u8');
  const isImage = data.file_type?.startsWith('image/');

  const retry = useCallback(() => {
    if (retryAttempt >= 1) {
      return;
    }
    setRetryAttempt(prev => prev + 1);
  }, [retryAttempt]);

  const likeDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const dislikeDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Update liked/disliked state when userActions change
  useEffect(() => {
    if (userActions && data.id) {
      setLiked(userActions.likedFileIds.has(data.id));
      setDisliked(userActions.dislikedFileIds.has(data.id));
    }
  }, [userActions, data.id]);

  const handleLike = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!currentUserId || !data.id) {
      window.location.href = '/auth/login';
      return;
    }

    const wasLiked = liked;
    const wasDisliked = disliked;

    if (wasDisliked) {
      setDisliked(false);
      setDownCount(prev => Math.max(0, prev - 1));
    }

    const newLiked = !wasLiked;
    setLiked(newLiked);
    setUpCount(prev => newLiked ? prev + 1 : Math.max(0, prev - 1));

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
          body: JSON.stringify({ fileId: data.id }),
        });

        if (!response.ok) {
          if (response.status === 401) {
            window.location.href = '/auth/login';
            return;
          }
          throw new Error('Failed to update like');
        }

        const result = await response.json();
        if (result.success && result.upCount !== undefined && result.downCount !== undefined) {
          setUpCount(result.upCount);
          setDownCount(result.downCount);
        }
      } catch (error) {
        console.error('Error updating like:', error);
        setLiked(wasLiked);
        setDisliked(wasDisliked);
        setUpCount(Number(data.up_count) || 0);
        setDownCount(Number(data.down_count) || 0);
      } finally {
        setIsLoading(false);
      }
    }, 500);
  }, [liked, disliked, data.id, data.up_count, data.down_count, currentUserId]);

  const handleDislike = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!currentUserId || !data.id) {
      window.location.href = '/auth/login';
      return;
    }

    const wasLiked = liked;
    const wasDisliked = disliked;

    if (wasLiked) {
      setLiked(false);
      setUpCount(prev => Math.max(0, prev - 1));
    }

    const newDisliked = !wasDisliked;
    setDisliked(newDisliked);
    setDownCount(prev => newDisliked ? prev + 1 : Math.max(0, prev - 1));

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
          body: JSON.stringify({ fileId: data.id }),
        });

        if (!response.ok) {
          if (response.status === 401) {
            window.location.href = '/auth/login';
            return;
          }
          throw new Error('Failed to update dislike');
        }

        const result = await response.json();
        if (result.success && result.upCount !== undefined && result.downCount !== undefined) {
          setUpCount(result.upCount);
          setDownCount(result.downCount);
        }
      } catch (error) {
        console.error('Error updating dislike:', error);
        setLiked(wasLiked);
        setDisliked(wasDisliked);
        setUpCount(Number(data.up_count) || 0);
        setDownCount(Number(data.down_count) || 0);
      } finally {
        setIsLoading(false);
      }
    }, 500);
  }, [liked, disliked, data.id, data.up_count, data.down_count, currentUserId]);

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

  const imageLink = data.file_type?.startsWith('image/') && data.endpoint 
    ? `/api/load/image/${data.endpoint}` 
    : `/api/load/image/${arrangeDateForThumbnail(data.created_at, retryAttempt)}/${data.unique_id}/thumbnail_${ParseFilename(data.filename)}.jpg`;

  return (
    <div className="flex gap-3 group">
      <Link to={`/${data.unique_id}`} className="relative flex-shrink-0 w-40 h-24 overflow-hidden rounded-lg bg-muted">
        {data.is_adult && <AdultContentBadge />}
        
        <ImageLoad
          link={imageLink}
          retry={retry}
          className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
          imageID={data.unique_id}
          index={0}
          hasAdultTag={data.is_adult || false}
          quality={15}
        />
        
        {(isVideo || isImage) && (
          <div className="absolute bottom-1 right-1 px-1 py-0.5 bg-black/80 rounded text-[10px] text-white font-medium z-10">
            {isVideo ? 'VIDEO' : 'IMAGE'}
          </div>
        )}
      </Link>
      
      <div className="flex-1 min-w-0 space-y-1">
        <Link to={`/${data.unique_id}`}>
          <h3 className="text-sm font-medium text-foreground line-clamp-2 leading-tight group-hover:text-primary transition-colors">
            {(data.file_title && data.file_title.trim() !== '') 
              ? data.file_title 
              : ParseFilename(data.filename)}
          </h3>
        </Link>
        
        {data.owner && (
          <div className="mt-1">
            <OwnerProfile owner={data.owner} size="sm" />
          </div>
        )}
        
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">
            {new Date(data.created_at).toLocaleDateString('en-US', { 
              month: 'short', 
              day: 'numeric',
              year: 'numeric'
            })}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatFileSize(data.file_size || 0)}
          </span>
        </div>

        <div className="flex items-center gap-1 mt-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleLike}
            disabled={isLoading || !data.id}
            className={`h-6 w-6 p-0 ${liked ? 'text-primary' : 'text-muted-foreground'}`}
          >
            <ThumbsUp className={`h-3 w-3 ${liked ? 'fill-current' : ''}`} />
          </Button>
          <span className="text-xs text-muted-foreground min-w-[20px]">{upCount}</span>
          
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleDislike}
            disabled={isLoading || !data.id}
            className={`h-6 w-6 p-0 ${disliked ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            <ThumbsDown className={`h-3 w-3 ${disliked ? 'fill-current' : ''}`} />
          </Button>
          <span className="text-xs text-muted-foreground min-w-[20px]">{downCount}</span>
        </div>
      </div>
    </div>
  );
};

export default RelatedVideoCard;

