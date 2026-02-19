import { useState, useEffect, useCallback, useRef } from "react";
import { Link, type MetaFunction } from "react-router";
import VideoCard from "~/routes/Home/components/VideoCard";
import type { FileType } from "~/lib/types";
import { useFileContext } from "~/lib/Context/Context";
import { useLocalPlaylist } from "~/lib/hooks/useLocalPlaylist";
import { Button } from "~/components/ui/button";
import { buildPageMeta } from "~/lib/seo";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Your playlist and saved videos | Memories",
    description:
      "View and manage your saved playlist on Memories. Revisit your watch-later list and organize the photos and videos you've saved.",
    canonicalPath: "/playlist",
  });

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

export default function PlaylistPage() {
  const { userId } = useFileContext();
  const { ids, count, clear } = useLocalPlaylist();
  const [files, setFiles] = useState<FileType[]>([]);
  const [userActions, setUserActions] = useState<{ likedFileIds: Set<string>; dislikedFileIds: Set<string> }>({
    likedFileIds: new Set(),
    dislikedFileIds: new Set(),
  });
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const observerRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);

  const fetchPage = useCallback(
    async (pageNum: number, append: boolean) => {
      if (ids.length === 0) {
        setLoading(false);
        return;
      }

      if (append) setLoadingMore(true);
      else setLoading(true);

      try {
        const res = await fetch("/api/playlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_ids: ids, page: pageNum }),
        });
        const json = await res.json();
        if (!res.ok) return;

        const newFiles: FileType[] = json.data || [];
        if (append) {
          setFiles((prev) => [...prev, ...newFiles]);
        } else {
          setFiles(newFiles);
        }

        setUserActions((prev) => {
          const liked = new Set(prev.likedFileIds);
          const disliked = new Set(prev.dislikedFileIds);
          (json.userActions?.likedFileIds || []).forEach((id: string) => liked.add(id));
          (json.userActions?.dislikedFileIds || []).forEach((id: string) => disliked.add(id));
          return { likedFileIds: liked, dislikedFileIds: disliked };
        });

        setHasMore(json.hasMore ?? false);
        setPage(pageNum);
      } catch (err) {
        console.error("Playlist fetch error:", err);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [ids]
  );

  useEffect(() => {
    if (ids.length === 0) {
      setFiles([]);
      setLoading(false);
      loadedRef.current = false;
      return;
    }
    loadedRef.current = true;
    fetchPage(1, false);
  }, [ids, fetchPage]);

  useEffect(() => {
    if (!observerRef.current || !hasMore || loadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loadingMore) {
          fetchPage(page + 1, true);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(observerRef.current);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, page, fetchPage]);

  if (loading) {
    return (
      <div className="mx-auto max-w-full xl:container py-8 px-4">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">My Playlist</h1>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-full xl:container py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">My Playlist</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {count} {count === 1 ? "item" : "items"} saved locally
          </p>
        </div>
        {count > 0 && (
          <Button variant="outline" size="sm" onClick={clear} className="text-destructive hover:text-destructive">
            Clear all
          </Button>
        )}
      </div>

      {files.length > 0 ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2">
            {files.map((file, index) => (
              <VideoCard
                key={file.id || index}
                data={file}
                index={index}
                currentUserId={userId || undefined}
                userActions={userActions}
              />
            ))}
          </div>
          {loadingMore && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2 mt-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonCard key={`more-${i}`} />
              ))}
            </div>
          )}
          <div ref={observerRef} className="h-10" />
        </>
      ) : (
        <div className="flex items-center flex-col justify-center py-20">
          <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-foreground mb-2">Your playlist is empty</h2>
          <p className="text-muted-foreground mb-6 text-center max-w-md">
            Tap the options menu on any video and select "Add to playlist" to save it here
          </p>
          <Link to="/">
            <Button variant="default" className="rounded-full px-8">
              Browse content
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}
