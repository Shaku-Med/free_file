import { useEffect, useCallback, useRef, useState } from "react";
import { useParams, Link, type MetaFunction } from "react-router";
import VideoCard from "~/routes/Home/components/VideoCard";
import type { FileType } from "~/lib/types";
import { useFileContext } from "~/lib/Context/Context";
import { buildPageMeta } from "~/lib/seo";
import { SignInToSeeMore } from "~/components/SignInWall";

export const meta: MetaFunction<{ tagname?: string }> = ({ params }) => {
  const tag = params?.tagname ? decodeURIComponent(params.tagname) : "";
  const title = tag
    ? `#${tag} – Photos and videos | Memories`
    : "Tag | Memories";
  const description = tag
    ? `Browse photos and videos tagged with ${tag} on Memories. Discover related content and creators.`
    : "Browse content by tag on Memories.";
  return buildPageMeta({
    title,
    description,
    canonicalPath: tag ? `/tag/${encodeURIComponent(tag)}` : "/tag",
  });
};

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
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3 gap-2">
      {Array.from({ length: 12 }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export default function TagPage() {
  const params = useParams();
  const { userId } = useFileContext();
  const tagname = params.tagname ?? "";
  const decodedTag = decodeURIComponent(tagname);

  const [files, setFiles] = useState<FileType[]>([]);
  const [userActions, setUserActions] = useState<{ likedFileIds: Set<string>; dislikedFileIds: Set<string> }>({
    likedFileIds: new Set(),
    dislikedFileIds: new Set(),
  });
  const [isLoading, setIsLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const nextCursorRef = useRef<{ cursor_score: number; cursor_id: string } | null>(null);
  const observerRef = useRef<HTMLDivElement>(null);

  const fetchTagFeed = useCallback(
    async (append: boolean) => {
      if (!decodedTag || isLoading) return;
      setIsLoading(true);
      try {
        const searchParams = new URLSearchParams();
        const cursor = nextCursorRef.current;
        if (append && cursor) {
          searchParams.set("cursor_score", String(cursor.cursor_score));
          searchParams.set("cursor_id", cursor.cursor_id);
        }
        const res = await fetch(`/api/tag/${encodeURIComponent(decodedTag)}?${searchParams}`);
        if (!res.ok) return;
        const json = await res.json();
        if (json.error) return;

        const data = json.data ?? [];
        setFiles((prev) => (append ? [...prev, ...data] : data));
        nextCursorRef.current = json.nextCursor ?? null;
        setHasMore(Boolean(json.nextCursor));

        if (json.userActions?.likedFileIds?.length || json.userActions?.dislikedFileIds?.length) {
          setUserActions((prev) => {
            const liked = new Set(prev.likedFileIds);
            const disliked = new Set(prev.dislikedFileIds);
            json.userActions.likedFileIds?.forEach((id: string) => liked.add(id));
            json.userActions.dislikedFileIds?.forEach((id: string) => disliked.add(id));
            return { likedFileIds: liked, dislikedFileIds: disliked };
          });
        }
      } catch (e) {
        console.error("Tag feed fetch error:", e);
      } finally {
        setIsLoading(false);
        setInitialLoading(false);
      }
    },
    [decodedTag, isLoading]
  );

  useEffect(() => {
    nextCursorRef.current = null;
    setFiles([]);
    setInitialLoading(true);
    setHasMore(true);
    fetchTagFeed(false);
  }, [decodedTag]);

  useEffect(() => {
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading) fetchTagFeed(true);
      },
      { threshold: 0.1 }
    );
    if (observerRef.current) ob.observe(observerRef.current);
    return () => ob.disconnect();
  }, [hasMore, isLoading, fetchTagFeed]);

  if (initialLoading) {
    return (
      <div className="mx-auto py-8">
        <FeedSkeleton />
      </div>
    );
  }

  return (
    <div className="mx-auto py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">
          Tag: <span className="text-primary">{decodedTag}</span>
        </h1>
      </div>

      {files.length > 0 ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3 gap-2">
            {files.map((file, index) => (
              <VideoCard
                key={file.id ?? index}
                data={file}
                index={index}
                currentUserId={userId ?? undefined}
                userActions={userActions}
                hideActions={{completely: false}}
              />
            ))}
          </div>
          {isLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3 gap-2 mt-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonCard key={`sk-${i}`} />
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
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <h2 className="text-xl font-semibold text-foreground mb-2">No content with this tag</h2>
          <p className="text-muted-foreground mb-4">Try another tag or go back to the feed.</p>
          <Link to="/" className="text-primary hover:underline">Back to feed</Link>
        </div>
      )}
    </div>
  );
}
