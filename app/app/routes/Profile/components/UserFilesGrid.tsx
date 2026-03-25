import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { FileType } from "~/lib/types";
import VideoCard from "~/routes/Home/components/VideoCard";

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
  /** Called after load more succeeds so the parent can update page cache. */
  onCacheUpdate?: (payload: { files: FileType[]; currentPage: number; hasMore: boolean }) => void;
  /** When true, scroll snap (or other layout) can be activated; wait for this before enabling. */
  dataReady?: boolean;
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
}: UserFilesGridProps) => {
  const [files, setFiles] = useState<FileType[]>(initialFiles);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(initialHasMore ?? initialFiles.length >= 20);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const observerRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);
  const [userActions, setUserActions] = useState<{ likedFileIds: Set<string>; dislikedFileIds: Set<string> } | undefined>(
    initialUserActions ? {
      likedFileIds: new Set(initialUserActions.likedFileIds),
      dislikedFileIds: new Set(initialUserActions.dislikedFileIds)
    } : undefined
  );

  // Create a stable key based on userId and initial files to detect profile changes
  const profileKey = useMemo(() => {
    return `${userId}-${initialFiles.length}-${initialFiles[0]?.id || ''}`;
  }, [userId, initialFiles]);

  // Reset state when userId or initialFiles change (when navigating to different profile)
  useEffect(() => {
    setFiles(initialFiles);
    setCurrentPage(initialPage);
    setHasMore(initialHasMore ?? initialFiles.length >= 20);
    setIsLoading(false);
    loadingRef.current = false;
    setUserActions(
      initialUserActions ? {
        likedFileIds: new Set(initialUserActions.likedFileIds),
        dislikedFileIds: new Set(initialUserActions.dislikedFileIds)
      } : undefined
    );
  }, [profileKey, userId, initialHasMore, initialPage]); // Reset when profile key changes

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    setIsLoading(true);

    try {
      const nextPage = currentPage + 1;
      const response = await fetch(`/api/user-files?userId=${userId}&page=${nextPage}&limit=20`);

      if (!response.ok) {
        setHasMore(false);
        return;
      }

      const result = await response.json();

      if (result.data && result.data.length > 0) {
        setFiles(prev => {
          const existingIds = new Set(prev.map(f => f.id || f.unique_id));
          const newFiles = result.data.filter((file: FileType) =>
            !existingIds.has(file.id || file.unique_id)
          );
          const merged = [...prev, ...newFiles];

          // Defer cache update to after state settles
          setTimeout(() => {
            onCacheUpdate?.({
              files: merged,
              currentPage: nextPage,
              hasMore: result.pagination?.hasMore || false,
            });
          }, 0);

          return merged;
        });

        setCurrentPage(nextPage);
        setHasMore(result.pagination?.hasMore || false);

        // Merge user actions from API response
        if (result.userActions) {
          setUserActions(prev => {
            const newLikedIds = new Set(prev?.likedFileIds || []);
            const newDislikedIds = new Set(prev?.dislikedFileIds || []);
            result.userActions.likedFileIds?.forEach((id: string) => newLikedIds.add(id));
            result.userActions.dislikedFileIds?.forEach((id: string) => newDislikedIds.add(id));
            return { likedFileIds: newLikedIds, dislikedFileIds: newDislikedIds };
          });
        }
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
      <div className="text-center py-12">
        <p className="text-muted-foreground text-lg">No uploads yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-data-ready={dataReady}>
      <h2 className="text-2xl font-semibold text-foreground">Uploads</h2>
      <div
        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3 gap-4"
        data-data-ready={dataReady}
      >
        {files.map((file, index) => (
            <VideoCard
              data={file}
              index={index}
              currentUserId={currentUserId}
              userActions={userActions}
              onUpdate={handleFileUpdate}
              showOwnerControls={true}
            />
        ))}
        {isLoading &&
          Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={`skel-${i}`} />
          ))
        }
      </div>
      {/* Sentinel — always rendered when there's more data, even during loading */}
      {hasMore && <div ref={observerRef} className="h-1" />}
    </div>
  );
};

export default UserFilesGrid;
