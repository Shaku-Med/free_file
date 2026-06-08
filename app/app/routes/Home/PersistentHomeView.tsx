/**
 * PersistentHomeView.tsx
 *
 * The actual feed JSX that used to live inside `routes/Home/index.tsx`'s
 * `PhotoDashboard` component. We pulled it out so it can be mounted ONCE
 * inside the AppShell scroll container  independent of the route match
 * lifecycle.
 *
 * Why:
 *   - When the user clicks a video and the URL becomes `/<uniqueId>`,
 *     React Router unmounts the matched `/` route. With this component
 *     mounted at the shell level instead, its DOM, refs, observers, and
 *     scroll position survive. Closing the watch page brings the feed
 *     back instantly with everything intact.
 *   - The route file (`routes/Home/index.tsx`) still owns `meta` and any
 *     loader so SEO / SSR are unaffected. Its component just returns
 *     null  the visible UI lives here.
 *
 * Visibility:
 *   - The parent (`BodyComponent`) toggles CSS `display` based on the
 *     current pathname. `display:none` preserves scroll within the
 *     surrounding `#scroll_container` because the container scrolls one
 *     of two stacked children. `ScrollRestoration` then keys per-path
 *     so each surface restores correctly.
 *
 * NB: every hook + state read here is identical to the original
 * component  this is a verbatim extraction, not a refactor.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { A11y, Keyboard, Navigation } from "swiper/modules";
import type { Swiper as SwiperType } from "swiper";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/pagination";

import { useFileContext } from "~/lib/Context/Context";
import SuggestedCreatorsRow, {
  type SuggestedCreator,
} from "./components/SuggestedCreatorsRow";
import VideoCard from "./components/VideoCard";
import { ContinueWatchingSection } from "./components/ContinueWatchingSection";
import type { FileType } from "~/lib/types";
import { groupConsecutiveReelClusters } from "~/lib/feed/groupConsecutiveReelClusters";
import { Button } from "~/components/ui/button";
import { Plus } from "lucide-react";
import { SignInToSeeMore } from "~/components/SignInWall";
import { Separator } from "~/components/ui/separator";

// Stable object reference so VideoCard's memo isn't broken by a fresh literal.
const FEED_HIDE_ACTIONS = { completely: false, halfway: true } as const;

// Inject a "People you may know" row after roughly this many feed cards.
// Capped at SUGGESTION_MAX_ROWS so the feed isn't flooded as the user scrolls /
// loads more  a couple of spaced rows, Instagram-style, not one every batch.
const SUGGESTION_EVERY = 10;
const SUGGESTION_MAX_ROWS = 2;
const SUGGESTIONS_PER_ROW = 6;
const SUGGESTION_POOL_SIZE = 30;

/** Wrap-around slice so each injected row surfaces different creators. */
function rotatedSlice(pool: SuggestedCreator[], start: number, count: number): SuggestedCreator[] {
  if (pool.length === 0) return [];
  const out: SuggestedCreator[] = [];
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    out.push(pool[(start + i) % pool.length]);
  }
  return out;
}

function SkeletonCard() {
  return (
    <div className="animate-pulse">
      <div className="aspect-video bg-muted rounded-xl" />
      <div className="flex gap-3 mt-3">
        <div className="w-9 h-9 rounded-full bg-muted shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-muted rounded w-[85%]" />
          <div className="h-3 bg-muted rounded w-[60%]" />
          <div className="h-3 bg-muted rounded w-[40%]" />
        </div>
      </div>
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 12 }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export default function PersistentHomeView() {
  const {
    files,
    setFiles,
    setIsModalOpen,
    observerRef,
    isLoading,
    initialLoading,
    userId,
    userActions,
    clearFeedHistory,
    userProfile,
  } = useFileContext();

  const handleFileUpdate = useCallback((fileId: string, updates: Partial<FileType>) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === fileId || f.unique_id === fileId ? { ...f, ...updates } : f)),
    );
  }, [setFiles]);

  // "People you may know" pool, fetched once per session. Rotated across
  // multiple feed positions so different creators surface each time.
  const [suggestions, setSuggestions] = useState<SuggestedCreator[]>([]);
  useEffect(() => {
    if (!userId) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/suggested-creators?limit=${SUGGESTION_POOL_SIZE}`, { credentials: "include" })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setSuggestions(Array.isArray(j?.data) ? (j.data as SuggestedCreator[]) : []);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Continue-watching strip position: a random EARLY card index, stable per
  // mount. Early + fixed so it doesn't drift downward as load-more appends.
  const continueWatchingPos = useRef(2 + Math.floor(Math.random() * 6)); // 2–7

  // Shared across feed-a / feed-b so suggestion rows keep rotating through the
  // pool (different creators at each position). Declared with the other hooks
  // (before any early return) to keep hook order stable.
  const suggestionRotation = useRef({ ordinal: 0 });

  if (initialLoading) {
    return (
      <div className="w-full min-w-0">
        <FeedSkeleton />
      </div>
    );
  }

  const gridClass =
    "grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3";

  const splitForHistory =
    userId && files.length > 0
      ? Math.max(1, Math.min(continueWatchingPos.current, files.length - 1))
      : 0;
  const feedBeforeHistory = (userId ? files.slice(0, splitForHistory) : files) as FileType[];
  const feedAfterHistory = (userId ? files.slice(splitForHistory) : []) as FileType[];

  // Reset rotation each full render pass (not a hook — safe after early return).
  suggestionRotation.current.ordinal = 0;

  const renderFeedGroups = (slice: FileType[], keyPrefix: string) => {
    const groups = groupConsecutiveReelClusters(slice);
    let indexCounter = 0;
    let cardsSinceSuggestion = 0;
    const nodes: React.ReactNode[] = [];

    const maybeInjectSuggestions = (anchorKey: string) => {
      if (suggestions.length === 0 || cardsSinceSuggestion < SUGGESTION_EVERY) return;
      if (suggestionRotation.current.ordinal >= SUGGESTION_MAX_ROWS) return;
      cardsSinceSuggestion = 0;
      const ord = suggestionRotation.current.ordinal++;
      const start = (ord * SUGGESTIONS_PER_ROW) % suggestions.length;
      nodes.push(
        <SuggestedCreatorsRow
          key={`sugg-${keyPrefix}-${anchorKey}-${ord}`}
          creators={rotatedSlice(suggestions, start, SUGGESTIONS_PER_ROW)}
          currentUserId={userId || null}
        />,
      );
    };

    for (const g of groups) {
      if (g.kind === "single") {
        const file = g.file;
        const index = indexCounter++;
        nodes.push(
          <VideoCard
            key={`${keyPrefix}-${file.id || index}`}
            data={file}
            index={index}
            currentUserId={userId || undefined}
            userActions={userActions}
            onUpdate={handleFileUpdate}
            hideActions={FEED_HIDE_ACTIONS}
          />,
        );
        cardsSinceSuggestion++;
        maybeInjectSuggestions(file.id || String(index));
        continue;
      }

      const clusterKey = g.files[0]?.feed_reel_cluster_id ?? g.files[0]?.id ?? keyPrefix;
      nodes.push(
        <div
          key={`${keyPrefix}-reel-${clusterKey}`}
          className="col-span-full w-full min-w-0 max-w-full overflow-hidden"
        >
          <Swiper
            modules={[Navigation, A11y, Keyboard]}
            slidesPerView={3.15}
            spaceBetween={10}
            speed={380}
            watchOverflow
            observer
            observeParents
            resizeObserver
            navigation
            keyboard={{ enabled: true, onlyInViewport: true }}
            breakpoints={{
              640: { slidesPerView: 2.5, spaceBetween: 12 },
              768: { slidesPerView: 3, spaceBetween: 12 },
              1024: { slidesPerView: 3.5, spaceBetween: 14 },
              1280: { slidesPerView: 4, spaceBetween: 14 },
              1536: { slidesPerView: 5, spaceBetween: 16 },
            }}
            className="feed-reel-swiper"
            onInit={(swiper: SwiperType) => {
              swiper.update();
            }}
          >
            {g.files.map((file, keyIndex) => {
              const index = indexCounter++;
              return (
                <SwiperSlide key={file.id || file.unique_id || keyIndex} className="!h-auto">
                  <VideoCard
                    data={file}
                    layout="reelStrip"
                    index={index}
                    currentUserId={userId || undefined}
                    userActions={userActions}
                    onUpdate={handleFileUpdate}
                    hideActions={FEED_HIDE_ACTIONS}
                  />
                </SwiperSlide>
              );
            })}
          </Swiper>
        </div>,
      );
    }

    return <div className={gridClass}>{nodes}</div>;
  };

  return (
    <div className="w-full min-w-0">
      {files.length > 0 ? (
        <>
          {userId ? (
            <>
              {renderFeedGroups(feedBeforeHistory, "feed-a")}
              <ContinueWatchingSection
                userId={userId}
                userActions={userActions}
                username={userProfile?.username ?? null}
              />
              <Separator className="my-4" />
              {feedAfterHistory.length > 0 ? renderFeedGroups(feedAfterHistory, "feed-b") : null}
            </>
          ) : (
            renderFeedGroups(files as FileType[], "feed")
          )}
          {isLoading && (
            <div className="mt-2 grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonCard key={`skeleton-${i}`} />
              ))}
            </div>
          )}
          {userId ? (
            <div ref={observerRef} className="h-10" />
          ) : (
            <SignInToSeeMore />
          )}
        </>
      ) : (
        <div className="flex items-center flex-col justify-center min-h-full bg-background">
          <div className="text-center">
            <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          </div>
          {userId ? (
            <>
              <h2 className="text-2xl font-semibold text-foreground mb-2">You're all caught up</h2>
              <p className="text-muted-foreground mb-6">
                Your feed only shows content you haven't seen yet. Reset feed to see everything again.
              </p>
              <Button
                onClick={() => clearFeedHistory()}
                variant="default"
                className="rounded-full px-8 py-3 font-medium shadow-lg"
              >
                Reset feed
              </Button>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-semibold text-foreground mb-2">No Media Found</h2>
              <p className="text-muted-foreground mb-6">Upload some files to get started</p>
              <Button
                onClick={() => setIsModalOpen(true)}
                variant="default"
                className="rounded-full px-8 py-3 font-medium shadow-lg"
              >
                <Plus className="w-5 h-5 mr-2" />
                Add Media
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
