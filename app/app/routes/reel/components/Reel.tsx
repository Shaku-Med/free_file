import { useEffect, useState, useCallback, useLayoutEffect, useRef } from "react";
import { RotateCw, X } from "lucide-react";
import { useFileContext } from "~/lib/Context/Context";
import { ReelSwiper } from "~/routes/reel/components/ReelSwiper";
import type { ReelAmbienceInfo } from "~/routes/pip/components/PipReelItem";
import Ambience from "~/components/accessories/CanvasGradient/Ambience";
import CommentSection from "~/routes/Dynamic/components/Comments/CommentSection";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerOverlay,
  DrawerTitle,
} from "~/components/ui/drawer";
import type { FileType } from "~/lib/types";
import { newReelFeedSeed } from "~/lib/feed/reelFeedSeed";
import { personalizationService } from "~/lib/Services/PersonalizationService";
import { cn } from "~/lib/utils";
import type { ReelProfileContext } from "~/lib/reel/reelProfileContext";

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
  /** From `/reel/:uniqueId/:ownerUsername` — queue that creator's reels before the global feed. */
  profileReelContext?: ReelProfileContext | null;
}

const Reel = ({ initialItems, initialUserActions, profileReelContext = null }: ReelProps) => {
  const { userId, playerSettings } = useFileContext();
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
  /** Reels the viewer has scrolled through this session (last = most recently left). */
  const watchedReelIdsRef = useRef<string[]>([]);
  /** Active reel + categories; updated on each swipe for session steering. */
  const prevReelRef = useRef<{ fileId: string; categories?: string[] } | null>(null);
  /** Skip duplicate `loadFeed(false)` for the same `initialItems` snapshot (loadFeed identity changes often). */
  const initialFeedKeyRef = useRef<string | null>(null);
  /** Invalidate in-flight fetches after navigation / reset so stale responses cannot clobber state. */
  const feedGenerationRef = useRef(0);
  const itemsRef = useRef<FileType[]>(initialItems || []);
  itemsRef.current = items;
  const profileReelContextRef = useRef<ReelProfileContext | null>(profileReelContext);
  const profileCursorRef = useRef(0);
  const profileExhaustedRef = useRef(!profileReelContext);

  const profileContextKey = profileReelContext
    ? `${profileReelContext.userId}:${profileReelContext.username}`
    : "__none__";

  const initialItemsKey =
    `${profileContextKey}|` +
    ((initialItems ?? [])
      .map((f) => (f.id ? String(f.id) : f.unique_id ?? ""))
      .join("|") || "__empty__");

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
    profileReelContextRef.current = profileReelContext;
    profileCursorRef.current = 0;
    profileExhaustedRef.current = !profileReelContext;
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
          if (shownIdsRef.current.size > 350) {
            const recent = itemsRef.current.slice(-150);
            shownIdsRef.current = new Set(
              recent.map((f) => (f.id ? String(f.id) : "")).filter(Boolean),
            );
          }
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
        const watchedReelIds = watchedReelIdsRef.current;
        if (watchedReelIds.length > 0) {
          params.set("watched_ids", JSON.stringify(watchedReelIds.slice(-50)));
        }

        const profileCtx = profileReelContextRef.current;
        if (profileCtx && !profileExhaustedRef.current) {
          params.set("profile_user_id", profileCtx.userId);
          params.set("profile_cursor_pos", String(profileCursorRef.current));
        } else if (profileCtx && profileExhaustedRef.current) {
          params.set("profile_user_id", profileCtx.userId);
          params.set("profile_exhausted", "1");
        }

        const contextFileId = (() => {
          if (profileCtx && !profileExhaustedRef.current) return null;
          if (append) {
            const current = itemsRef.current[itemsRef.current.length - 1];
            if (current?.id) return String(current.id).toLowerCase();
          }
          const seed = initialItems?.[0];
          if (seed?.id) return String(seed.id).toLowerCase();
          const lastWatched = watchedReelIdsRef.current;
          if (lastWatched.length > 0) return lastWatched[lastWatched.length - 1];
          return null;
        })();
        if (contextFileId && /^[0-9a-f-]{36}$/i.test(contextFileId)) {
          params.set("context_file_id", contextFileId);
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

        if (data.profile_exhausted === true) {
          profileExhaustedRef.current = true;
        }
        if (typeof data.profile_next_cursor === "number" && Number.isFinite(data.profile_next_cursor)) {
          profileCursorRef.current = data.profile_next_cursor;
        }

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
          let newItems = incoming.filter((f: FileType) => !existingIds.has(String(f.id)));
          if (newItems.length === 0 && userId && incoming.length > 0) {
            newItems = incoming;
          }
          appendedCount = newItems.length;
          setItems([...prev, ...newItems]);
        }

        if (userId) {
          setHasMore(
            incoming.length > 0 ||
              Boolean(data.nextCursor) ||
              Boolean(data.profile_has_more && !data.profile_exhausted),
          );
        } else if (append && appendedCount === 0) {
          setHasMore(false);
        } else {
          setHasMore(Boolean(data.nextCursor));
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

  // ONE shared, fixed ambience driven by whichever reel is active. The ref
  // always points at the active reel's <video>; the descriptor (id) remounts
  // the single Ambience so it re-samples the new element on each swipe.
  const ambientEnabled = playerSettings?.ambientMode === true;
  // Follow the same ambient controls as the watch page: sync mode + size.
  const ambientSync = playerSettings?.ambientSync === true;
  const ambientSize = Math.max(1, Math.min(2, playerSettings?.ambientSize ?? 2));
  const activeVideoElRef = useRef<HTMLVideoElement | null>(null);
  const [ambienceDesc, setAmbienceDesc] = useState<{
    id: string;
    colors: string[];
    aspect: number | null;
    fileId: string;
    ownerId?: string;
  } | null>(null);
  const onActiveAmbience = useCallback((info: ReelAmbienceInfo) => {
    activeVideoElRef.current = info.el;
    setAmbienceDesc((prev) =>
      prev && prev.id === info.id && prev.aspect === info.aspect
        ? prev
        : { id: info.id, colors: info.colors, aspect: info.aspect, fileId: info.fileId, ownerId: info.ownerId },
    );
  }, []);

  // ONE global comments panel for the whole /reel page: it follows whichever
  // reel is playing (keyed by the active reel's fileId) and, on large screens,
  // docks beside the reel — pushing the stage (ambience + player) left so the
  // player still fits. Small screens fall back to the shared bottom drawer.
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentsReloadToken, setCommentsReloadToken] = useState(0);
  const [isLargeScreen, setIsLargeScreen] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsLargeScreen(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  // The comments panel follows the active reel by INDEX (reported the instant
  // the slide changes), not the ambience callback — that one waits for the video
  // element, so it lagged/blanked the panel on swipe.
  const [activeReel, setActiveReel] = useState<{ fileId: string; ownerId?: string } | null>(null);
  const onActiveItemChange = useCallback(
    (info: { fileId: string; ownerId?: string; categories?: string[] }) => {
      setActiveReel((prev) =>
        prev && prev.fileId === info.fileId && prev.ownerId === info.ownerId
          ? prev
          : { fileId: info.fileId, ownerId: info.ownerId },
      );

      const prev = prevReelRef.current;
      if (prev && prev.fileId !== info.fileId) {
        // Left the previous reel → treat it as watched: bias the session toward
        // its categories and remember it so we don't keep re-serving it.
        personalizationService.trackSessionWatch(prev.fileId, prev.categories ?? null);
        const idLower = prev.fileId.toLowerCase();
        const without = watchedReelIdsRef.current.filter((x) => x !== idLower);
        without.push(idLower);
        watchedReelIdsRef.current = without.slice(-50);
      }
      prevReelRef.current = { fileId: info.fileId, categories: info.categories };
    },
    [],
  );

  const activeCommentFileId = activeReel?.fileId ?? null;
  const activeCommentOwnerId = activeReel?.ownerId;
  const commentsBody =
    commentsOpen && activeCommentFileId ? (
      <CommentSection
        key={activeCommentFileId}
        fileId={activeCommentFileId}
        currentUserId={userId ?? undefined}
        fileOwnerId={activeCommentOwnerId}
        isReel
        fillHeight
        reloadToken={commentsReloadToken}
        className="min-h-0 flex-1"
      />
    ) : null;

  return (
    <div className="fixed inset-0 z-[var(--z-reel)] reel_p flex">
      {/* STAGE: ambience + reel deck. Shrinks (flex-1) when the comments dock
          opens on large screens, so the whole stage — ambience included — is
          pushed left and the player still fits beside the panel. */}
      <div className="relative h-full min-h-0 min-w-0 flex-1">
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

        {/* The live, shared ambience  one Ambience instance, fixed behind the
            deck, sized to the active reel's aspect ratio, re-sampling the new
            video on each swipe (keyed by id). */}
        {ambientEnabled && ambienceDesc && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="relative h-full max-h-[100dvh] origin-center overflow-visible blur-3xl opacity-80 lg:h-[min(96dvh,calc(100dvh-1rem))]"
              style={{
                // Size follows the ambient-size control (1×2×).
                transform: `scale(${ambientSize})`,
                aspectRatio:
                  ambienceDesc.aspect && ambienceDesc.aspect > 0
                    ? String(ambienceDesc.aspect)
                    : "9 / 16",
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
            >
              <Ambience
                key={ambienceDesc.id}
                colors={ambienceDesc.colors}
                videoRef={activeVideoElRef}
                videoReady
                sync={ambientSync}
              />
            </div>
          </div>
        )}
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
          onActiveAmbience={onActiveAmbience}
          commentsOpen={commentsOpen}
          onCommentsOpenChange={setCommentsOpen}
          onActiveItemChange={onActiveItemChange}
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

      {/* Desktop book-form comments dock: docks on the right and pushes the
          stage left (its animated width drives the flex-1 stage). */}
      <div
        className={cn(
          "hidden shrink-0 overflow-hidden transition-[width] duration-300 ease-out lg:block",
          commentsOpen ? "lg:w-[26rem]" : "lg:w-0",
        )}
      >
        {commentsOpen && activeCommentFileId ? (
          <div className="flex h-full w-[26rem] flex-col overflow-hidden border-l border-border bg-background pt-[var(--app-top-nav-h,0px)]">
            <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
              <h2 className="text-base font-semibold text-foreground">Comments</h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCommentsReloadToken((t) => t + 1)}
                  aria-label="Reload comments"
                  className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <RotateCw className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setCommentsOpen(false)}
                  aria-label="Close comments"
                  className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-2">
              {commentsBody}
            </div>
          </div>
        ) : null}
      </div>

      {/* Small screens: the shared bottom drawer (no push). */}
      {!isLargeScreen ? (
        <Drawer open={commentsOpen} onOpenChange={setCommentsOpen} direction="bottom">
          <DrawerOverlay className="bg-black/30" />
          <DrawerContent className="flex flex-col gap-0 overflow-hidden p-0 data-[vaul-drawer-direction=bottom]:inset-x-0 data-[vaul-drawer-direction=bottom]:mx-auto data-[vaul-drawer-direction=bottom]:h-[85dvh] data-[vaul-drawer-direction=bottom]:max-h-[85dvh] data-[vaul-drawer-direction=bottom]:w-full data-[vaul-drawer-direction=bottom]:max-w-2xl data-[vaul-drawer-direction=bottom]:rounded-t-2xl data-[vaul-drawer-direction=bottom]:border-t data-[vaul-drawer-direction=bottom]:border-border">
            <DrawerHeader className="shrink-0 flex-row items-center justify-between border-b px-3 py-2 text-left">
              <DrawerTitle className="text-base">Comments</DrawerTitle>
              <button
                type="button"
                onClick={() => setCommentsReloadToken((t) => t + 1)}
                aria-label="Reload comments"
                className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <RotateCw className="h-4 w-4" />
              </button>
            </DrawerHeader>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{commentsBody}</div>
          </DrawerContent>
        </Drawer>
      ) : null}
    </div>
  );
};

export default Reel;
