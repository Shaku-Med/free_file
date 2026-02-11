import { useState, useCallback, useEffect } from "react";
import Dislike from "./Icons/Dislike";
import { useSidebar } from "~/components/ui/sidebar";

interface DislikedProps {
  fileId: string;
  dislikeCount: number;
  disliked: boolean;
  onUpdate?: (updates: { liked: boolean; disliked: boolean; like_count: number; dislike_count: number }) => void;
}

const Disliked = ({ fileId, dislikeCount, disliked, onUpdate }: DislikedProps) => {
  const { isMobile, state } = useSidebar();
  const [displayDisliked, setDisplayDisliked] = useState(disliked);
  const [displayCount, setDisplayCount] = useState(dislikeCount);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setDisplayDisliked(disliked);
    setDisplayCount(dislikeCount);
  }, [disliked, dislikeCount]);

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!fileId || isLoading) return;
      const wasDisliked = displayDisliked;
      setDisplayDisliked(!wasDisliked);
      setDisplayCount((c) => (wasDisliked ? Math.max(0, c - 1) : c + 1));
      setIsLoading(true);
      try {
        const res = await fetch("/api/dislikes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId }),
        });
        if (res.status === 401) {
          window.location.href = "/auth/login";
          return;
        }
        const data = await res.json();
        if (data.success) {
          setDisplayDisliked(data.disliked);
          setDisplayCount(Number(data.dislike_count ?? 0));
          onUpdate?.({
            liked: data.liked,
            disliked: data.disliked,
            like_count: data.like_count ?? 0,
            dislike_count: data.dislike_count ?? 0,
          });
        } else {
          setDisplayDisliked(wasDisliked);
          setDisplayCount(dislikeCount);
        }
      } catch {
        setDisplayDisliked(wasDisliked);
        setDisplayCount(dislikeCount);
      } finally {
        setIsLoading(false);
      }
    },
    [fileId, isLoading, dislikeCount, onUpdate, displayDisliked]
  );

  const hoverClass = isMobile || state === "collapsed" ? "hover:bg-card/50" : "hover:bg-background";
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isLoading}
      className={`flex items-center justify-center gap-1 p-2 border-l border-r ${hoverClass} ${displayDisliked ? "text-destructive" : ""}`}
    >
      <Dislike className={`w-5 h-5 rotate-180 ${displayDisliked ? "fill-current" : ""}`} disliked={displayDisliked} />
      <span className="text-sm tabular-nums">{displayCount >= 1000 ? `${(displayCount / 1000).toFixed(1)}K` : displayCount}</span>
    </button>
  );
};

export default Disliked;
