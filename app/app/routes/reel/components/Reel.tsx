import { useEffect, useState, useCallback, useLayoutEffect } from "react";
import { ReelSwiper } from "~/routes/reel/components/ReelSwiper";
import { getRandomThumbnail, getVideoSrc } from "~/lib/utils";
import type {FileType} from '~/lib/types'

interface ReelProps {
  initialItems?: FileType[];
}

const Reel = ({ initialItems }: ReelProps) => {
  const [items, setItems] = useState<FileType[]>(initialItems || []);
  const [seenIds, setSeenIds] = useState<string[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

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

        const response = await fetch(
          `/api/feed?file_type=video`,
          {
            headers: {
              Accept: "application/json",
            },
          }
        );

        if (!response.ok) {
          setHasMore(false);
          return;
        }

        let data = await response.json()

        setItems((prev: FileType[]) => [...prev, ...data.data]);
      } catch (e) {
        return;
      } finally {
        setIsLoadingMore(false);
      }
    },
    [isLoadingMore, items.length, seenIds]
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