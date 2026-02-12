import { useEffect, useRef, useState } from "react";
import { ReelCard } from "./ReelCard";
import type { FileType } from "~/lib/types";

interface ReelSwiperProps {
  items: FileType[];
  onEndReached?: () => void;
  userActions?: { likedFileIds: string[]; dislikedFileIds: string[] };
}

export const ReelSwiper = ({ items, onEndReached, userActions }: ReelSwiperProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hasRequestedMore, setHasRequestedMore] = useState(false);

  useEffect(() => {
    setHasRequestedMore(false);
  }, [items.length]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !onEndReached) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
      if (!hasRequestedMore && distanceFromBottom <= clientHeight * 2) {
        setHasRequestedMore(true);
        onEndReached();
      }
    };

    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, [onEndReached, hasRequestedMore, items.length]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full bg-black overflow-y-auto overflow-x-hidden snap-y snap-mandatory scroll-smooth"
    >
      {items.map((item) => (
        <div
          key={item.id}
          data-slug-id={item.id}
          data-file-id={item.id}
          className="min-h-screen h-screen w-full flex items-center justify-center snap-start shrink-0"
        >
          <ReelCard
            data={item}
            userActions={userActions}
          />
        </div>
      ))}
    </div>
  );
};


