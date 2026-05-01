import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { FileType } from "~/lib/types";
import VideoCard from "~/routes/Home/components/VideoCard";
import { SignInToSeeMore } from "~/components/SignInWall";
import { groupConsecutiveReelClusters } from "~/lib/feed/groupConsecutiveReelClusters";
import { Swiper, SwiperSlide } from "swiper/react";
import { Navigation, A11y, Keyboard } from "swiper/modules";
import type { Swiper as SwiperType } from "swiper";
import "swiper/css";
import "swiper/css/navigation";

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

interface UserFilesGridProps {
  files: FileType[];
  userId: string;
  currentUserId?: string;
  userActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
  initialHasMore?: boolean;
  /** When restoring from cache, pass the page we left off at so we can continue from there. */
  initialPage?: number;
  /** Called after load more succeeds so the parent can update page cache (include userActions so like state survives prop sync). */
  onCacheUpdate?: (payload: {
    files: FileType[];
    currentPage: number;
    hasMore: boolean;
    userActions: { likedFileIds: string[]; dislikedFileIds: string[] };
  }) => void;
  /** When true, scroll snap (or other layout) can be activated; wait for this before enabling. */
  dataReady?: boolean;
  /** Section heading above the grid */
  sectionTitle?: string;
  emptyMessage?: string;
}

const UserFilesGrid = ({
  files: initialFiles,
  userId,
  currentUserId,
  userActions: initialUserActions,
  initialHasMore,
  initialPage = 1,
  onCacheUpdate,
  dataReady = true,
  sectionTitle = "Uploads",
  emptyMessage = "No uploads yet",
}: UserFilesGridProps) => {
  const [files, setFiles] = useState<FileType[]>(initialFiles);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(initialHasMore ?? initialFiles.length >= 20);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const observerRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);
  const lastProfileUserIdRef = useRef<string | null>(null);
  const [userActions, setUserActions] = useState<{ likedFileIds: Set<string>; dislikedFileIds: Set<string> } | undefined>(
    initialUserActions ? {
      likedFileIds: new Set(initialUserActions.likedFileIds),
      dislikedFileIds: new Set(initialUserActions.dislikedFileIds)
    } : undefined
  );

  // Reset only when viewing a different profile (userId). Do not reset when parent passes a longer
  // file list after load-more — that used to wipe merged like/dislike state from the API.
  useEffect(() => {
    if (lastProfileUserIdRef.current === userId) return;
    lastProfileUserIdRef.current = userId;
    setFiles(initialFiles);
    setCurrentPage(initialPage);
    setHasMore(initialHasMore ?? initialFiles.length >= 20);
    setIsLoading(false);
    loadingRef.current = false;
    setUserActions(
      initialUserActions
        ? {
            likedFileIds: new Set(initialUserActions.likedFileIds),
            dislikedFileIds: new Set(initialUserActions.dislikedFileIds),
          }
        : undefined
    );
  }, [userId, initialFiles, initialHasMore, initialPage, initialUserActions]);

  const anyUploadProcessing = useMemo(
    () =>
      files.some((f) => {
        if (f.endpoint) return false;
        const st = (f.upload_status || "").toLowerCase();
        // Go worker: queued | running. Node in-process worker (legacy): processing.
        return st === "queued" || st === "running" || st === "processing";
      }),
    [files],
  );

  useEffect(() => {
    if (currentUserId !== userId || !anyUploadProcessing) return;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/user-files?userId=${encodeURIComponent(userId)}&page=1&limit=40`,
          { credentials: "include" },
        );
        if (!res.ok) return;
        const json = (await res.json()) as {
          data?: FileType[];
        };
        const fresh = json.data;
        if (!fresh?.length) return;
        setFiles((prev) =>
          prev.map((f) => {
            const id = f.id || f.unique_id;
            const upd = fresh.find((x) => (x.id || x.unique_id) === id);
            return upd ? { ...f, ...upd } : f;
          }),
        );
      } catch {
        /* ignore */
      }
    };
    const iv = setInterval(tick, 3500);
    void tick();
    return () => clearInterval(iv);
  }, [currentUserId, userId, anyUploadProcessing]);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    setIsLoading(true);

    try {
      const nextPage = currentPage + 1;
      const response = await fetch(`/api/user-files?userId=${userId}&page=${nextPage}&limit=20`, {
        credentials: 'include',
      });

      if (!response.ok) {
        setHasMore(false);
        return;
      }

      const result = await response.json();

      if (result.data && result.data.length > 0) {
        const likedFromPage = (result.userActions?.likedFileIds ?? []) as string[];
        const dislikedFromPage = (result.userActions?.dislikedFileIds ?? []) as string[];

        let cacheUserActions: { likedFileIds: string[]; dislikedFileIds: string[] } | undefined;
        setUserActions((prev) => {
          const newLikedIds = new Set(prev?.likedFileIds || []);
          const newDislikedIds = new Set(prev?.dislikedFileIds || []);
          likedFromPage.forEach((id: string) => newLikedIds.add(id));
          dislikedFromPage.forEach((id: string) => newDislikedIds.add(id));
          cacheUserActions = {
            likedFileIds: [...newLikedIds],
            dislikedFileIds: [...newDislikedIds],
          };
          return { likedFileIds: newLikedIds, dislikedFileIds: newDislikedIds };
        });

        setFiles((prev) => {
          const existingIds = new Set(prev.map((f) => f.id || f.unique_id));
          const newFiles = result.data.filter(
            (file: FileType) => !existingIds.has(file.id || file.unique_id)
          );
          const merged = [...prev, ...newFiles];

          setTimeout(() => {
            if (cacheUserActions) {
              onCacheUpdate?.({
                files: merged,
                currentPage: nextPage,
                hasMore: result.pagination?.hasMore || false,
                userActions: cacheUserActions,
              });
            }
          }, 0);

          return merged;
        });

        setCurrentPage(nextPage);
        setHasMore(result.pagination?.hasMore || false);
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error("Error loading more files:", error);
      setHasMore(false);
    } finally {
      setIsLoading(false);
      loadingRef.current = false;
    }
  }, [hasMore, currentPage, userId, onCacheUpdate]);

  const handleFileUpdate = useCallback((fileId: string, updates: Partial<FileType>) => {
    setFiles((prev) =>
      prev.map((file) => (file.id === fileId ? { ...file, ...updates } : file))
    );
  }, []);

  // Observer: only trigger loadMore when the sentinel enters view and we're not already loading
  useEffect(() => {
    const el = observerRef.current;
    if (!el || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingRef.current) {
          loadMore();
        }
      },
      { threshold: 0.1, rootMargin: "200px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, hasMore]);

  if (files.length === 0) {
    return (
      <div className="space-y-6" data-data-ready={dataReady}>
        <div className="text-center py-12">
          <p className="text-muted-foreground text-lg">{emptyMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-data-ready={dataReady}>
      <div data-data-ready={dataReady}>
        {(() => {
          const groups = groupConsecutiveReelClusters(files);
          let indexCounter = 0;
          return (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3 gap-4">
              {groups.map((g) => {
                if (g.kind === "single") {
                  const file = g.file;
                  const index = indexCounter++;
                  return (
                    <VideoCard
                      key={file.id || file.unique_id || index}
                      data={file}
                      index={index}
                      currentUserId={currentUserId}
                      userActions={userActions}
                      onUpdate={handleFileUpdate}
                      showOwnerControls={true}
                      hideActions={{ completely: false }}
                    />
                  );
                }
                const clusterKey =
                  g.files[0]?.feed_reel_cluster_id ?? g.files[0]?.id ?? "profile";
                return (
                  <div
                    key={`profile-reel-${clusterKey}`}
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
                      onInit={(swiper: SwiperType) => swiper.update()}
                    >
                      {g.files.map((file, keyIndex) => {
                        const index = indexCounter++;
                        return (
                          <SwiperSlide
                            key={file.id || file.unique_id || keyIndex}
                            className="!h-auto"
                          >
                            <VideoCard
                              data={file}
                              layout="reelStrip"
                              index={index}
                              currentUserId={currentUserId}
                              userActions={userActions}
                              onUpdate={handleFileUpdate}
                              showOwnerControls={true}
                              hideActions={{ completely: false, halfway: true }}
                            />
                          </SwiperSlide>
                        );
                      })}
                    </Swiper>
                  </div>
                );
              })}
              {isLoading &&
                Array.from({ length: 4 }).map((_, i) => (
                  <SkeletonCard key={`skel-${i}`} />
                ))}
            </div>
          );
        })()}
      </div>
      {hasMore && (
        currentUserId ? (
          <div ref={observerRef} className="h-1" />
        ) : (
          <SignInToSeeMore />
        )
      )}
    </div>
  );
};

export default UserFilesGrid;
