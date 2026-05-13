import { useEffect, useState, useCallback, useLayoutEffect, useRef } from "react";
import { useFileContext } from "~/lib/Context/Context";
import { ReelSwiper } from "~/routes/reel/components/ReelSwiper";
import type { FileType } from "~/lib/types";
import { newReelFeedSeed } from "~/lib/feed/reelFeedSeed";
import { personalizationService } from "~/lib/Services/PersonalizationService";
import { cn } from "~/lib/utils";

/**
 * Poster/thumbnail palette → soft radial washes (same hex source as `ImageLoad` / player poster).
 * Base page color remains shadcn `bg-zinc-950` on a sibling layer.
 */
function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace("#", "").trim();
  if (raw.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(raw)) {
    return `rgba(24,24,27,${alpha})`;
  }
  const n = parseInt(raw, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function reelPosterBackdropImage(colors: string[]): string | undefined {
  const list = colors.filter(Boolean).slice(0, 6);
  if (list.length === 0) return undefined;
  const spots = ["18% 42%", "50% 52%", "82% 42%", "34% 68%", "66% 34%"];
  const count = Math.min(spots.length, Math.max(3, list.length));
  const layers: string[] = [];
  for (let i = 0; i < count; i++) {
    const col = list[i % list.length];
    const a0 = 0.42 - i * 0.055;
    layers.push(
      `radial-gradient(ellipse 88% 74% at ${spots[i]}, ${hexToRgba(col, Math.max(0.14, a0))} 0%, ${hexToRgba(col, 0.1)} 48%, transparent 74%)`,
    );
  }
  return layers.join(", ");
}

/**
 * Dual masks (intersect): radial blob + wide horizontal feather so the ~600px glow never reads
 * as a clipped rectangle; horizontal mask uses wide side fades (~18–22% each side).
 */
const REEL_AMB_MASKHorizontal = `linear-gradient(90deg,
  transparent 0%,
  rgba(0,0,0,0.08) 7%,
  rgba(0,0,0,0.28) 14%,
  rgba(0,0,0,0.55) 20%,
  rgba(0,0,0,0.8) 26%,
  rgba(0,0,0,0.95) 32%,
  rgba(0,0,0,1) 40%,
  rgba(0,0,0,1) 60%,
  rgba(0,0,0,0.95) 68%,
  rgba(0,0,0,0.8) 74%,
  rgba(0,0,0,0.55) 80%,
  rgba(0,0,0,0.28) 86%,
  rgba(0,0,0,0.08) 93%,
  transparent 100%)`;

const REEL_AMB_MASKRadial = `radial-gradient(ellipse 118% 98% at 50% 50%,
  rgba(0,0,0,0.94) 0%,
  rgba(0,0,0,0.7) 28%,
  rgba(0,0,0,0.42) 50%,
  rgba(0,0,0,0.18) 68%,
  rgba(0,0,0,0.06) 82%,
  rgba(0,0,0,0.02) 91%,
  transparent 100%)`;

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

  const [reelPosterColors, setReelPosterColors] = useState<string[]>([]);

  const onReelPosterColors = useCallback((colors: string[]) => {
    setReelPosterColors(colors);
  }, []);

  const posterBackdropImage = reelPosterBackdropImage(reelPosterColors);

  return (
    <div className="fixed inset-0 z-40 reel_p">
      {/*
        Ambient plate ~600px wide (centered): solid zinc-950 + poster palette from the active slide’s thumbnail.
      */}
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
        <div className="absolute inset-0 bg-zinc-950" />
        <div className="absolute inset-0 flex items-center justify-center px-0">
          <div
            className={cn(
              "ambience-wrap pointer-events-none relative z-0 w-full overflow-visible",
              "h-full max-h-[100dvh] max-w-[min(100vw,600px)]",
              "lg:h-[min(96dvh,calc(100dvh-1rem))] lg:max-h-[100dvh]",
              "origin-center scale-[1.2]",
            )}
          >
            <div
              className="absolute inset-0 blur-3xl opacity-[0.78]"
              style={{
                ...(posterBackdropImage ? { backgroundImage: posterBackdropImage } : {}),
                WebkitMaskImage: `${REEL_AMB_MASKRadial}, ${REEL_AMB_MASKHorizontal}`,
                WebkitMaskSize: "100% 100%, 100% 100%",
                WebkitMaskRepeat: "no-repeat, no-repeat",
                WebkitMaskPosition: "center, center",
                maskImage: `${REEL_AMB_MASKRadial}, ${REEL_AMB_MASKHorizontal}`,
                maskSize: "100% 100%, 100% 100%",
                maskRepeat: "no-repeat, no-repeat",
                maskPosition: "center, center",
                maskComposite: "intersect",
              }}
            />
          </div>
        </div>
      </div>

      <div className="relative z-[1] flex h-full min-h-0 flex-col">
      {items.length > 0 ? (
        <ReelSwiper
          items={items}
          onEndReached={handleEndReached}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          userActions={userActions}
          onReelPosterColors={onReelPosterColors}
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
    </div>
  );
};

export default Reel;
