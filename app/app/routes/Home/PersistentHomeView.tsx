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
import { Carousel, CarouselItem } from "~/components/Carousel/Carousel";

import { useFileContext } from "~/lib/Context/Context";
import { cn } from "~/lib/utils";

// YouTube-style home filter chips. Values must match the category strings stored
// on files (feed RPC matches f.categories @> the chip value exactly).
const HOME_CHIPS = [
  "Music", "Gaming", "Entertainment", "Education", "Technology", "Sports",
  "News", "Lifestyle", "Anime", "Film", "Automotive", "Art", "Nature",
] as const;
import SuggestedCreatorsRow, {
  type SuggestedCreator,
} from "./components/SuggestedCreatorsRow";
import VideoCard from "./components/VideoCard";
import { ContinueWatchingSection } from "./components/ContinueWatchingSection";
import type { FileType } from "~/lib/types";
import { groupConsecutiveReelClusters } from "~/lib/feed/groupConsecutiveReelClusters";
import { FEED_HIDE_ACTIONS } from "~/lib/feed/feedVideoCardLayout";
import { Button } from "~/components/ui/button";
import { Check, Clapperboard, Image as ImageIcon, Plus, TriangleAlert } from "lucide-react";
import EmptyState from "~/components/EmptyState";
import { SignInToSeeMore } from "~/components/SignInWall";
import { Separator } from "~/components/ui/separator";

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

/** The feed's column rhythm, in one place: it was written out three times. */
const FEED_GRID =
  "grid w-full min-w-0 grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 sm:gap-y-8 lg:grid-cols-3 lg:gap-y-10 xl:grid-cols-4";

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
    <div className={FEED_GRID}>
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
    feedError,
    retryFeed,
    userId,
    userActions,
    clearFeedHistory,
    userProfile,
    feedCategory,
    setFeedCategory,
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
          // overflow-visible: the carousel clips X itself; clipping here would
          // cut the hover scale and the arrow shadows.
          className="col-span-full w-full min-w-0 max-w-full overflow-visible"
        >
          <div className="mb-2 flex items-center gap-1.5">
            <Clapperboard className="h-5 w-5 text-foreground" aria-hidden />
            <h2 className="text-base font-semibold tracking-tight sm:text-lg">Shorts</h2>
          </div>
          <Carousel label="Shorts" itemWidth={168} gapClassName="gap-2.5">
            {g.files.map((file, keyIndex) => {
              const index = indexCounter++;
              return (
                <CarouselItem key={file.id || file.unique_id || keyIndex}>
                  <VideoCard
                    data={file}
                    layout="reelStrip"
                    index={index}
                    currentUserId={userId || undefined}
                    userActions={userActions}
                    onUpdate={handleFileUpdate}
                    hideActions={FEED_HIDE_ACTIONS}
                  />
                </CarouselItem>
              );
            })}
          </Carousel>
        </div>,
      );
    }

    return <div className={FEED_GRID}>{nodes}</div>;
  };

  return (
    <div className="w-full min-w-0">
      {/* YouTube-style filter chips: All + categories. Functional  drives the feed. */}
      <div className="-mx-1 mb-5 flex gap-2 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {[null, ...HOME_CHIPS].map((value) => {
          const label = value ?? "All";
          const active = (feedCategory ?? null) === value;
          return (
            <button
              key={label}
              type="button"
              onClick={() => setFeedCategory(value)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-foreground text-background"
                  : "bg-muted text-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
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
            <div className={cn(FEED_GRID, "mt-2")}>
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
      ) : isLoading ? (
        <FeedSkeleton />
      ) : feedError ? (
        <EmptyState
          variant="page"
          icon={TriangleAlert}
          title="Couldn't load your feed"
          description="Check your connection and try again."
          action={
            <Button onClick={() => retryFeed()} className="rounded-full px-6">
              Try again
            </Button>
          }
        />
      ) : userId ? (
        <EmptyState
          variant="page"
          icon={Check}
          title="You're all caught up"
          description="Your feed only shows what you haven't seen yet."
          action={
            <Button onClick={() => clearFeedHistory()} className="rounded-full px-6">
              Reset feed
            </Button>
          }
        />
      ) : (
        <EmptyState
          variant="page"
          icon={ImageIcon}
          title="Nothing here yet"
          action={
            <Button onClick={() => setIsModalOpen(true)} className="rounded-full px-6">
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              Add media
            </Button>
          }
        />
      )}
    </div>
  );
}
