import { useCallback, useEffect, useRef, useState } from "react";
import type { MetaFunction } from "react-router";
import { Images, Plus, TriangleAlert } from "lucide-react";
import { buildPageMeta } from "~/lib/seo";
import { useFileContext } from "~/lib/Context/Context";
import { FEED_CATEGORIES } from "~/lib/feed/feedCategories";
import { cn } from "~/lib/utils";
import type { FileType } from "~/lib/types";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import EmptyState from "~/components/EmptyState";
import { SignInToSeeMore } from "~/components/SignInWall";
import Masonry from "./Masonry";
import PostTile from "./PostTile";
import { usePostsFeed } from "./usePostsFeed";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Posts – Photos on Memories",
    description: "Browse photos shared by creators on Memories.",
    canonicalPath: "/posts",
  });

// Varied heights, so the skeleton already reads as a photo wall.
const SKELETON_ASPECTS = [0.8, 1.33, 0.66, 1, 0.75, 1.2, 0.9, 0.7, 1.5, 0.8];

function PostsSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div className="grid w-full grid-cols-2 gap-x-2 gap-y-5 sm:grid-cols-3 sm:gap-x-4 sm:gap-y-6 lg:grid-cols-4 2xl:grid-cols-5" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="min-w-0">
          <Skeleton className="w-full rounded-xl" style={{ aspectRatio: String(SKELETON_ASPECTS[i % SKELETON_ASPECTS.length]) }} />
          <div className="mt-2 flex gap-2 px-0.5">
            <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5 pt-0.5">
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const keyOf = (post: FileType) => post.unique_id;

export default function PostsPage() {
  const { userId, setIsModalOpen } = useFileContext();
  const [category, setCategory] = useState<string | null>(null);
  const { posts, loading, initialLoading, error, hasMore, loadMore, retry } = usePostsFeed(category, Boolean(userId));

  // Each photo's own shape once it has loaded, so its tile can follow it.
  const [aspects, setAspects] = useState<Record<string, number>>({});
  const onSize = useCallback((key: string, width: number, height: number) => {
    const aspect = Math.round((width / height) * 100) / 100;
    setAspects((prev) => (prev[key] === aspect ? prev : { ...prev, [key]: aspect }));
  }, []);
  const aspectOf = useCallback((key: string) => aspects[key], [aspects]);

  // Start loading the next page well before the end comes into view.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: "1200px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadMore, posts.length]);

  return (
    <div className="w-full min-w-0 pb-8">
      <header className="mb-4 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">Posts</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Photos from creators on Memories</p>
        </div>
        {userId && (
          <Button variant="secondary" className="shrink-0 rounded-full" onClick={() => setIsModalOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            New post
          </Button>
        )}
      </header>

      <div className="-mx-1 mb-6 flex gap-3 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {[null, ...FEED_CATEGORIES].map((value) => {
          const active = category === value;
          return (
            <button
              key={value ?? "all"}
              type="button"
              aria-pressed={active}
              onClick={() => setCategory(value)}
              className={cn(
                "h-8 shrink-0 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors",
                active
                  ? "bg-foreground text-background"
                  : "bg-muted text-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {value ?? "All"}
            </button>
          );
        })}
      </div>

      {initialLoading ? (
        <PostsSkeleton />
      ) : posts.length > 0 ? (
        <>
          <Masonry
            items={posts}
            keyOf={keyOf}
            aspectOf={aspectOf}
            resetKey={category}
            renderItem={(post, index) => (
              <PostTile key={post.unique_id} post={post} index={index} aspect={aspects[post.unique_id]} onSize={onSize} />
            )}
          />
          {loading && <PostsSkeleton count={5} />}
          {userId ? <div ref={sentinelRef} className="h-10" aria-hidden /> : <SignInToSeeMore />}
        </>
      ) : error ? (
        <EmptyState
          variant="page"
          icon={TriangleAlert}
          title="Couldn't load posts"
          description="Check your connection and try again."
          action={
            <Button onClick={retry} className="rounded-full px-6">
              Try again
            </Button>
          }
        />
      ) : (
        <EmptyState
          variant="page"
          icon={Images}
          title={category ? `No ${category} posts yet` : "No posts yet"}
          description="Photos people share show up here."
          action={
            userId ? (
              <Button onClick={() => setIsModalOpen(true)} className="rounded-full px-6">
                <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                Share a photo
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
