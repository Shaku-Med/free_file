import { useState, useCallback, useEffect } from "react";
import Like from "./Icons/Like";
import { useSidebar } from "~/components/ui/sidebar";
import { buildLoginHref } from "~/lib/loginRedirect";
import { personalizationService } from "~/lib/Services/PersonalizationService";

interface LikedProps {
  fileId: string;
  likeCount: number;
  liked: boolean;
  onUpdate?: (updates: { liked: boolean; disliked: boolean; like_count: number; dislike_count: number }) => void;
}

const Liked = ({ fileId, likeCount, liked, onUpdate }: LikedProps) => {
  const { isMobile, state } = useSidebar();
  const [displayLiked, setDisplayLiked] = useState(liked);
  const [displayCount, setDisplayCount] = useState(likeCount);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setDisplayLiked(liked);
    setDisplayCount(likeCount);
  }, [liked, likeCount]);

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!fileId || isLoading) return;
      const wasLiked = displayLiked;
      setDisplayLiked(!wasLiked);
      setDisplayCount((c) => (wasLiked ? Math.max(0, c - 1) : c + 1));
      setIsLoading(true);
      try {
        const res = await fetch("/api/likes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId }),
        });
        if (res.status === 401) {
          window.location.href = buildLoginHref(window.location.pathname + window.location.search);
          return;
        }
        const data = await res.json();
        if (data.success) {
          setDisplayLiked(data.liked);
          setDisplayCount(Number(data.like_count ?? 0));
          // Steer the in-session feed toward what the user just liked.
          if (data.liked && Array.isArray(data.categories)) {
            personalizationService.trackSessionLike(data.categories);
          }
          onUpdate?.({
            liked: data.liked,
            disliked: data.disliked,
            like_count: data.like_count ?? 0,
            dislike_count: data.dislike_count ?? 0,
          });
        } else {
          setDisplayLiked(wasLiked);
          setDisplayCount(likeCount);
        }
      } catch {
        setDisplayLiked(wasLiked);
        setDisplayCount(likeCount);
      } finally {
        setIsLoading(false);
      }
    },
    [fileId, isLoading, likeCount, onUpdate, displayLiked]
  );

  const hoverClass = isMobile || state === "collapsed" ? "hover:bg-card/50" : "hover:bg-background";
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isLoading}
      className={`flex items-center justify-center gap-1 p-2 rounded-l-full ${hoverClass} ${displayLiked ? "text-primary" : ""}`}
    >
      <Like className={`w-5 h-5 ${displayLiked ? "fill-current" : ""}`} liked={displayLiked} />
      <span className="text-sm tabular-nums">{displayCount >= 1000 ? `${(displayCount / 1000).toFixed(1)}K` : displayCount}</span>
    </button>
  );
};

export default Liked;
