import { useState, useCallback, useRef, useEffect } from "react";
import type { FileType } from "~/lib/types";
import VideoCard from "~/routes/Home/components/VideoCard";

interface UserFilesGridProps {
  files: FileType[];
  userId: string;
  currentUserId?: string;
  userActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
  initialHasMore?: boolean;
}

const UserFilesGrid = ({
  files: initialFiles,
  userId,
  currentUserId,
  userActions: initialUserActions,
  initialHasMore
}: UserFilesGridProps) => {
  const [files, setFiles] = useState<FileType[]>(initialFiles);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(initialHasMore ?? initialFiles.length >= 20);
  const [currentPage, setCurrentPage] = useState(1);
  const observerRef = useRef<HTMLDivElement | null>(null);
  const [userActions, setUserActions] = useState<{ likedFileIds: Set<string>; dislikedFileIds: Set<string> } | undefined>(
    initialUserActions ? {
      likedFileIds: new Set(initialUserActions.likedFileIds),
      dislikedFileIds: new Set(initialUserActions.dislikedFileIds)
    } : undefined
  );

  const loadMore = useCallback(async () => {
    if (isLoading || !hasMore) return;

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
        setFiles(prev => [...prev, ...result.data]);
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
    }
  }, [isLoading, hasMore, currentPage, userId]);

  const handleFileUpdate = useCallback((fileId: string, updates: Partial<FileType>) => {
    setFiles((prev) =>
      prev.map((file) => (file.id === fileId ? { ...file, ...updates } : file))
    );
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    if (observerRef.current) {
      observer.observe(observerRef.current);
    }

    return () => observer.disconnect();
  }, [loadMore, hasMore, isLoading]);

  if (files.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground text-lg">No uploads yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-foreground">Uploads</h2>
      <div className="grid grid-cols-2 gap-4">
        {files.map((file, index) => (
          <div key={file.unique_id || index} className="w-full">
            <VideoCard
              data={file}
              index={index}
              currentUserId={currentUserId}
              userActions={userActions}
              onUpdate={handleFileUpdate}
              showOwnerControls={true}
            />
          </div>
        ))}
      </div>
      {hasMore && (
        <div ref={observerRef} className="h-10 flex items-center justify-center mt-4">
          {isLoading && (
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
              <span className="text-sm text-muted-foreground">Loading more...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default UserFilesGrid;
