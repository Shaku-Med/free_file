import { useEffect, useState, useCallback, useLayoutEffect, useRef } from "react";
import { ReelSwiper } from "~/routes/reel/components/ReelSwiper";
import type { FileType } from "~/lib/types";

interface ReelProps {
  initialItems?: FileType[];
}

const Reel = ({ initialItems }: ReelProps) => {
  const [items, setItems] = useState<FileType[]>(initialItems || []);
  const [nextCursor, setNextCursor] = useState<{ cursor_pos: number } | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [userActions, setUserActions] = useState<{ likedFileIds: string[]; dislikedFileIds: string[] }>({ likedFileIds: [], dislikedFileIds: [] });
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
        if (append && nextCursor) {
          params.set("cursor_pos", String(nextCursor.cursor_pos));
        }
        if (shownIdsRef.current.size > 0) {
          params.set("exclude_ids", JSON.stringify(Array.from(shownIdsRef.current).slice(0, 500)));
        }

        const response = await fetch(`/api/reel-feed?${params}`, {
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
          if (!append) return data.data ?? [];
          const existingIds = new Set(prev.map((f: FileType) => f.id));
          const newItems = (data.data ?? []).filter((f: FileType) => !existingIds.has(f.id));
          return [...prev, ...newItems];
        });
        setNextCursor(data.nextCursor ?? null);
        setHasMore(Boolean(data.nextCursor));
        if (data.userActions) {
          setUserActions((prev) => ({
            likedFileIds: [...new Set([...prev.likedFileIds, ...(data.userActions.likedFileIds ?? [])])],
            dislikedFileIds: [...new Set([...prev.dislikedFileIds, ...(data.userActions.dislikedFileIds ?? [])])],
          }));
        }
        if (!append) setInitialLoadDone(true);
      } catch (e) {
        setHasMore(false);
        if (!append) setInitialLoadDone(true);
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
    <div className="fixed inset-0 z-0 bg-black">
      {items.length > 0 ? (
        <ReelSwiper items={items} onEndReached={handleEndReached} userActions={userActions} />
      ) : initialLoadDone ? (
        <div className="h-full w-full flex flex-col items-center justify-center gap-4 text-white/80 px-4">
          <p className="text-center text-lg">No reels to show yet.</p>
          <p className="text-center text-sm">Upload or mark content as reels to see them here.</p>
        </div>
      ) : (
        <div className="h-full w-full flex items-center justify-center">
          <div className="w-10 h-10 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
};

export default Reel;