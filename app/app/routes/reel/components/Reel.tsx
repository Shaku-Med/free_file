import { useEffect, useState, useCallback, useLayoutEffect, useRef } from "react";
import { ReelSwiper } from "~/routes/reel/components/ReelSwiper";
import { getRandomThumbnail, getVideoSrc } from "~/lib/utils";
import type {FileType} from '~/lib/types'

interface ReelProps {
  initialItems?: FileType[];
}

const Reel = ({ initialItems }: ReelProps) => {
  const [items, setItems] = useState<FileType[]>(initialItems || []);
  const [nextCursor, setNextCursor] = useState<{ cursor_score: number; cursor_id: string } | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const shownIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const container = document.getElementById("scroll_container");
    if (!container) return;

    const previousOverflowY = container.style.overflowY;
    container.style.overflowY = "hidden";

    return () => {
      container.style.overflowY = previousOverflowY;
    };
  }, []);

  const loadFeed = useCallback(
    async (append: boolean) => {
      if (isLoadingMore) return;
      if (!append && items.length > 1) return;

      try {
        if (append) {
          setIsLoadingMore(true);
        }

        const params = new URLSearchParams();
        params.set("file_type", "video");
        if (append && nextCursor) {
          params.set("cursor_score", String(nextCursor.cursor_score));
          params.set("cursor_id", nextCursor.cursor_id);
        }
        if (shownIdsRef.current.size > 0) {
          params.set("exclude_ids", JSON.stringify(Array.from(shownIdsRef.current).slice(0, 500)));
        }

        const response = await fetch(`/api/feed?${params}`, {
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          setHasMore(false);
          return;
        }

        const data = await response.json();

        if (Array.isArray(data.data)) {
          data.data.forEach((f: FileType) => { if (f.id) shownIdsRef.current.add(f.id); });
        }
        setItems((prev) => {
          if (!append) return data.data;
          const existingIds = new Set(prev.map((f: FileType) => f.id));
          const newItems = data.data.filter((f: FileType) => !existingIds.has(f.id));
          return [...prev, ...newItems];
        });
        setNextCursor(data.nextCursor ?? null);
        setHasMore(Boolean(data.nextCursor));
      } catch (e) {
        setHasMore(false);
      } finally {
        setIsLoadingMore(false);
      }
    },
    [isLoadingMore, items.length, nextCursor]
  );

  useLayoutEffect(() => {
    void loadFeed(false);
  }, [loadFeed, initialItems]);

  const handleEndReached = useCallback(() => {
    if (!hasMore) return;
    void loadFeed(true);
  }, [hasMore, loadFeed]);

  return (
    <div className="fixed inset-0 z-0">
      {items.length > 0 && <ReelSwiper items={items} onEndReached={handleEndReached} />}
    </div>
  );
};

export default Reel;