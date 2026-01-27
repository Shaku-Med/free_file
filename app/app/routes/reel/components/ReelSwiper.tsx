import { useEffect, useRef, useState } from "react";
import { ReelCard } from "./ReelCard";
import type { FileType } from "~/lib/types";

interface ReelSwiperProps {
  items: FileType[];
  onEndReached?: () => void;
}

export const ReelSwiper = ({ items, onEndReached }: ReelSwiperProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hasRequestedMore, setHasRequestedMore] = useState(false);

  // When the items list grows (new page loaded), allow another prefetch
  useEffect(() => {
    setHasRequestedMore(false);
  }, [items.length]);

  // Trigger load more when user scrolls near the bottom of the stack
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !onEndReached) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);

      // When within ~2 viewport heights of the bottom, load more once
      if (!hasRequestedMore && distanceFromBottom <= clientHeight * 2) {
        setHasRequestedMore(true);
        onEndReached();
      }
    };

    el.addEventListener("scroll", handleScroll);
    return () => {
      el.removeEventListener("scroll", handleScroll);
    };
  }, [onEndReached, hasRequestedMore, items.length]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full bg-black overflow-y-auto snap-y snap-mandatory"
    >
      {items.map((item, index) => {
        const fileId = item.id;
        return (
          <div
            key={item.id}
            data-slug-id={item.id}
            data-file-id={fileId}
            className="flex items-center justify-center snap-start"
          >
            <ReelCard
            key={index || 0}
            data={item as FileType}
            />
          </div>
        );
      })}
    </div>
  );
};


