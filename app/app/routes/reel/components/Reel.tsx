import { useEffect, useState, useCallback, useLayoutEffect, useRef } from "react";
import { useFileContext } from "~/lib/Context/Context";
import { ReelSwiper } from "~/routes/reel/components/ReelSwiper";
import type { FileType } from "~/lib/types";
import { newReelFeedSeed } from "~/lib/feed/reelFeedSeed";
import { personalizationService } from "~/lib/Services/PersonalizationService";

interface ReelProps {
  initialItems?: FileType[];
  /** SSR / `/reel/:uniqueId` loader: viewer like & dislike ids (lowercased UUID strings). */
  initialUserActions?: { likedFileIds: string[]; dislikedFileIds: string[] };
}

const Reel = ({ initialItems, initialUserActions }: ReelProps) => {
  const { userId } = useFileContext();
  const [items, setItems] = useState<FileType[]>(initialItems || []);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [userActions, setUserActions] = useState<{ likedFileIds: string[]; dislikedFileIds: string[] }>(() => ({
    likedFileIds: [...(initialUserActions?.likedFileIds ?? [])],
    dislikedFileIds: [...(initialUserActions?.dislikedFileIds ?? [])],
  }));
  const shownIdsRef = useRef<Set<string>>(new Set());
  const feedSeedRef = useRef<string>(newReelFeedSeed());
  /** Skip duplicate `loadFeed(false)` for the same `initialItems` snapshot (loadFeed identity changes often). */
  const initialFeedKeyRef = useRef<string | null>(null);
  /** Invalidate in-flight fetches after navigation / reset so stale responses cannot clobber state. */
  const feedGenerationRef = useRef(0);
  const itemsRef = useRef<FileType[]>(initialItems || []);
  itemsRef.current = items;

  const initialItemsKey =
    (initialItems ?? [])
      .map((f) => (f.id ? String(f.id) : f.unique_id ?? ""))
      .join("|") || "__empty__";

  useLayoutEffect(() => {
    feedGenerationRef.current += 1;
    const seed = initialItems ?? [];
    setItems(seed);
    itemsRef.current = seed;
    setHasMore(true);
    setInitialLoadDone(false);
    setIsLoadingMore(false);
    shownIdsRef.current.clear();
    initialFeedKeyRef.current = null;
    for (const f of seed) {
      if (f.id) shownIdsRef.current.add(String(f.id));
    }
    setUserActions({
      likedFileIds: [...(initialUserActions?.likedFileIds ?? [])],
      dislikedFileIds: [...(initialUserActions?.dislikedFileIds ?? [])],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `initialItemsKey` is the navigation identity; props match that render.
  }, [initialItemsKey]);

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
      // Only block concurrent appends. Initial loads must run even if a previous append is in flight
      // (e.g. route change), otherwise the feed never hydrates.
      if (append && isLoadingMore) return;
      if (append && !userId) return;
      if (!append && initialFeedKeyRef.current === initialItemsKey) return;

      const generation = feedGenerationRef.current;

      try {
        if (append) {
          setIsLoadingMore(true);
        }

        feedSeedRef.current = newReelFeedSeed();
        const params = new URLSearchParams();
        params.set("seed", feedSeedRef.current);
        if (shownIdsRef.current.size > 0) {
          params.set("exclude_ids", JSON.stringify(Array.from(shownIdsRef.current).slice(0, 500)));
        }
        const sessionCats = personalizationService.getSessionCategories();
        if (sessionCats.length > 0) {
          params.set("session_cats", JSON.stringify(sessionCats));
        }

        const response = await fetch(`/api/reel-feed?${params}`, {
          headers: { Accept: "application/json" },
          credentials: "include",
        });

        if (!response.ok) {
          if (generation !== feedGenerationRef.current) return;
          setHasMore(false);
          if (!append) setInitialLoadDone(true);
          return;
        }

        const data = await response.json();
        if (generation !== feedGenerationRef.current) return;
        const incoming: FileType[] = Array.isArray(data.data) ? data.data : [];

        if (incoming.length > 0) {
          incoming.forEach((f) => {
            if (f.id) shownIdsRef.current.add(String(f.id));
          });
        }

        let appendedCount = 0;
        if (!append) {
          const seed = initialItems ?? [];
          const seen = new Set<string>();
          const merged: FileType[] = [];
          for (const f of seed) {
            const id = f.id ? String(f.id) : "";
            if (id && !seen.has(id)) {
              seen.add(id);
              merged.push(f);
            }
          }
          for (const f of incoming) {
            const id = f.id ? String(f.id) : "";
            if (id && !seen.has(id)) {
              seen.add(id);
              merged.push(f);
            }
          }
          const nextItems = merged.length > 0 ? merged : seed.length > 0 ? seed : incoming;
          setItems(nextItems);
          initialFeedKeyRef.current = initialItemsKey;
          for (const f of nextItems) {
            if (f.id) shownIdsRef.current.add(String(f.id));
          }
        } else {
          const prev = itemsRef.current;
          const existingIds = new Set(prev.map((f: FileType) => String(f.id)));
          const newItems = incoming.filter((f: FileType) => !existingIds.has(String(f.id)));
          appendedCount = newItems.length;
          setItems([...prev, ...newItems]);
        }

        if (append && appendedCount === 0) {
          setHasMore(false);
        } else {
          setHasMore(Boolean(data.nextCursor) && Boolean(userId));
        }

        if (data.userActions) {
          setUserActions((prev) => {
            const merge = (a: string[], b: string[]) =>
              [...new Set([...a, ...b].map((id) => String(id).toLowerCase()))];
            return {
              likedFileIds: merge(prev.likedFileIds, data.userActions.likedFileIds ?? []),
              dislikedFileIds: merge(prev.dislikedFileIds, data.userActions.dislikedFileIds ?? []),
            };
          });
        }
        if (!append) setInitialLoadDone(true);
      } catch {
        if (generation !== feedGenerationRef.current) return;
        setHasMore(false);
        if (!append) setInitialLoadDone(true);
      } finally {
        if (generation === feedGenerationRef.current) {
          setIsLoadingMore(false);
        }
      }
    },
    [initialItemsKey, initialItems, isLoadingMore, userId],
  );

  useLayoutEffect(() => {
    void loadFeed(false);
  }, [loadFeed, initialItemsKey]);

  const handleEndReached = useCallback(() => {
    if (!userId || !hasMore || isLoadingMore) return;
    void loadFeed(true);
  }, [userId, hasMore, isLoadingMore, loadFeed]);

  return (
    <div className="fixed inset-0 z-40 bg-black reel_p">
      {items.length > 0 ? (
        <ReelSwiper
          items={items}
          onEndReached={handleEndReached}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          userActions={userActions}
        />
      ) : initialLoadDone ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-4 text-white/80">
          <p className="text-center text-lg">No reels to show yet.</p>
          <p className="text-center text-sm">Upload or mark content as reels to see them here.</p>
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        </div>
      )}
    </div>
  );
};

export default Reel;
