import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { FileType } from "~/lib/types";
import VideoCard from "~/routes/Home/components/VideoCard";
import { FEED_HIDE_ACTIONS } from "~/lib/feed/feedVideoCardLayout";
import { SignInToSeeMore } from "~/components/SignInWall";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import {
  groupProfileTabItems,
  type ProfileTabRenderGroup,
} from "~/lib/feed/groupProfileTabItems";

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

type ProfileVideoTab = "liked" | "history" | "adult" | "shorts" | "videos" | "popular";

/** Channel "See all" grids — public content, paginate without sign-in. */
const PUBLIC_SECTION_TABS = new Set<ProfileVideoTab>(["shorts", "videos", "popular"]);

function getPageScrollRoot(): HTMLElement | null {
  return document.getElementById("scroll_container");
}

interface ProfileTabVideosGridProps {
  tab: ProfileVideoTab;
  userId: string;
  profileOwnerUsername: string;
  currentUserId?: string;
  sectionTitle: string;
  emptyMessage: string;
  dataReady?: boolean;
}

function gridClassForGroup(group: ProfileTabRenderGroup): string {
  if (group.variant === "shorts") {
    return "grid w-full min-w-0 grid-cols-2 gap-4 sm:gap-5 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4";
  }
  return "grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4";
}

const ProfileTabVideosGrid = ({
  tab,
  userId,
  profileOwnerUsername,
  currentUserId,
  sectionTitle,
  emptyMessage,
  dataReady = true,
}: ProfileTabVideosGridProps) => {
  const [files, setFiles] = useState<FileType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [userActions, setUserActions] = useState<
    { likedFileIds: Set<string>; dislikedFileIds: Set<string> } | undefined
  >(undefined);
  const observerRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);

  const mergeUserActions = useCallback((liked: string[], disliked: string[]) => {
    setUserActions((prev) => {
      const newLiked = new Set(prev?.likedFileIds || []);
      const newDisliked = new Set(prev?.dislikedFileIds || []);
      liked.forEach((id) => newLiked.add(id));
      disliked.forEach((id) => newDisliked.add(id));
      return { likedFileIds: newLiked, dislikedFileIds: newDisliked };
    });
  }, []);

  useEffect(() => {
    setFiles([]);
    setCurrentPage(1);
    setHasMore(false);
    setUserActions(undefined);
    setIsLoading(true);
    setIsLoadingMore(false);
    setLoadError(false);
    loadingRef.current = false;

    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `/api/profile-tab?userId=${encodeURIComponent(userId)}&tab=${tab}&page=1&limit=20`,
          { credentials: "include" }
        );
        if (cancelled) return;
        if (!response.ok) {
          setHasMore(false);
          setLoadError(true);
          return;
        }
        const result = await response.json();
        if (cancelled) return;
        const rows = result.data ?? [];
        const likedFromPage = (result.userActions?.likedFileIds ?? []) as string[];
        const dislikedFromPage = (result.userActions?.dislikedFileIds ?? []) as string[];
        setFiles(rows);
        setHasMore(result.pagination?.hasMore ?? false);
        setCurrentPage(1);
        mergeUserActions(likedFromPage, dislikedFromPage);
      } catch (e) {
        console.error("ProfileTabVideosGrid initial load:", e);
        if (!cancelled) {
          setHasMore(false);
          setLoadError(true);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, tab, mergeUserActions, reloadNonce]);

  const allowPagination = !!currentUserId || PUBLIC_SECTION_TABS.has(tab);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore || !allowPagination) return;
    loadingRef.current = true;
    setIsLoadingMore(true);

    try {
      const nextPage = currentPage + 1;
      const response = await fetch(
        `/api/profile-tab?userId=${encodeURIComponent(userId)}&tab=${tab}&page=${nextPage}&limit=20`,
        { credentials: "include" }
      );

      if (!response.ok) {
        setHasMore(false);
        return;
      }

      const result = await response.json();
      const likedFromPage = (result.userActions?.likedFileIds ?? []) as string[];
      const dislikedFromPage = (result.userActions?.dislikedFileIds ?? []) as string[];

      mergeUserActions(likedFromPage, dislikedFromPage);

      if (result.data && result.data.length > 0) {
        setFiles((prev) => {
          const existingIds = new Set(prev.map((f) => f.id || f.unique_id));
          const newFiles = result.data.filter(
            (file: FileType) => !existingIds.has(file.id || file.unique_id)
          );
          return [...prev, ...newFiles];
        });
        setCurrentPage(nextPage);
        setHasMore(result.pagination?.hasMore || false);
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error("ProfileTabVideosGrid loadMore:", error);
      setHasMore(false);
    } finally {
      setIsLoadingMore(false);
      loadingRef.current = false;
    }
  }, [hasMore, currentPage, userId, tab, mergeUserActions, allowPagination]);

  const handleFileUpdate = useCallback((fileId: string, updates: Partial<FileType>) => {
    setFiles((prev) =>
      prev.map((file) => (file.id === fileId ? { ...file, ...updates } : file))
    );
  }, []);

  useEffect(() => {
    const el = observerRef.current;
    if (!el || !hasMore || !allowPagination) return;

    const scrollRoot = getPageScrollRoot();
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingRef.current) {
          loadMore();
        }
      },
      {
        threshold: 0.1,
        rootMargin: "200px",
        ...(scrollRoot ? { root: scrollRoot } : {}),
      }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, hasMore, allowPagination, files.length]);

  const groups = useMemo(() => {
    const raw = groupProfileTabItems(files);
    if (PUBLIC_SECTION_TABS.has(tab) && raw.length === 1) {
      return [{ ...raw[0], label: sectionTitle }];
    }
    return raw;
  }, [files, tab, sectionTitle]);

  if (!isLoading && files.length === 0) {
    return (
      <div className="space-y-6" data-data-ready={dataReady}>
        <div className="text-center py-12">
          {loadError ? (
            <>
              <p className="text-muted-foreground text-lg mb-4">Couldn't load these.</p>
              <Button variant="outline" size="sm" onClick={() => setReloadNonce((n) => n + 1)}>
                Try again
              </Button>
            </>
          ) : (
            <p className="text-muted-foreground text-lg">{emptyMessage}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-data-ready={dataReady}>
      <div className="space-y-8 sm:space-y-10" data-data-ready={dataReady}>
        {groups.map((group, groupIndex) => {
          let indexCounter = 0;
          for (let g = 0; g < groupIndex; g++) {
            indexCounter += groups[g].files.length;
          }
          const groupKey = `${group.variant}-${group.label}-${group.files[0]?.id ?? groupIndex}`;

          return (
            <section key={groupKey} className="space-y-3">
              <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                {group.label}
              </h2>
              <div className={gridClassForGroup(group)}>
                {group.files.map((file, i) => {
                  const index = indexCounter + i;
                  return (
                    <VideoCard
                      key={file.id || file.unique_id || index}
                      data={file}
                      index={index}
                      layout={group.variant === "shorts" ? "reelStrip" : undefined}
                      currentUserId={currentUserId}
                      userActions={userActions}
                      onUpdate={handleFileUpdate}
                      showOwnerControls={true}
                      hideActions={FEED_HIDE_ACTIONS}
                      profileOwnerUsername={
                        tab === "shorts" && group.variant === "shorts"
                          ? profileOwnerUsername
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
        {(isLoading || isLoadingMore) && (
          <div
            className={cn(
              "grid w-full min-w-0 gap-4 sm:gap-5",
              tab === "shorts"
                ? "grid-cols-2 md:grid-cols-3 xl:grid-cols-4"
                : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
            )}
          >
            {Array.from({ length: files.length === 0 ? 6 : 4 }).map((_, i) => (
              <SkeletonCard key={`skel-${i}`} />
            ))}
          </div>
        )}
      </div>
      {hasMore &&
        (allowPagination ? (
          <div ref={observerRef} className="h-10 w-full shrink-0" aria-hidden />
        ) : (
          <SignInToSeeMore />
        ))}
    </div>
  );
};

export default ProfileTabVideosGrid;
