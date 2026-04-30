import { useState, useCallback, useRef, useEffect } from "react";
import type { FileType } from "~/lib/types";
import VideoCard from "~/routes/Home/components/VideoCard";
import { SignInToSeeMore } from "~/components/SignInWall";

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

type ProfileVideoTab = "liked" | "history";

interface ProfileTabVideosGridProps {
  tab: ProfileVideoTab;
  userId: string;
  currentUserId?: string;
  sectionTitle: string;
  emptyMessage: string;
  dataReady?: boolean;
}

const ProfileTabVideosGrid = ({
  tab,
  userId,
  currentUserId,
  sectionTitle,
  emptyMessage,
  dataReady = true,
}: ProfileTabVideosGridProps) => {
  const [files, setFiles] = useState<FileType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
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
    loadingRef.current = false;

    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `/api/profile-tab?userId=${encodeURIComponent(userId)}&tab=${tab}&page=1&limit=20`,
          { credentials: "include" }
        );
        if (!response.ok || cancelled) {
          if (!cancelled) setHasMore(false);
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
        if (!cancelled) setHasMore(false);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, tab, mergeUserActions]);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    setIsLoading(true);

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
      setIsLoading(false);
      loadingRef.current = false;
    }
  }, [hasMore, currentPage, userId, tab, mergeUserActions]);

  const handleFileUpdate = useCallback((fileId: string, updates: Partial<FileType>) => {
    setFiles((prev) =>
      prev.map((file) => (file.id === fileId ? { ...file, ...updates } : file))
    );
  }, []);

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

  if (!isLoading && files.length === 0) {
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
      <div
        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3 gap-4"
        data-data-ready={dataReady}
      >
        {files.map((file, index) => (
          <VideoCard
            key={file.id || file.unique_id || index}
            data={file}
            index={index}
            currentUserId={currentUserId}
            userActions={userActions}
            onUpdate={handleFileUpdate}
            showOwnerControls={true}
            hideActions={{completely: false}}
          />
        ))}
        {isLoading &&
          Array.from({ length: files.length === 0 ? 6 : 4 }).map((_, i) => (
            <SkeletonCard key={`skel-${i}`} />
          ))}
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

export default ProfileTabVideosGrid;
