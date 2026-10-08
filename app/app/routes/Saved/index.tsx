import { useCallback, useEffect, useRef, useState } from "react";
import { redirect, useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";
import { Bookmark, Lock } from "lucide-react";
import { isAuthenticated } from "~/lib/Security/Password";
import { buildPageMeta } from "~/lib/seo";
import { listSavedFiles } from "~/lib/save/savedFiles.server";
import { rememberSaves } from "~/lib/save/useSave";
import { groupConsecutiveReelClusters } from "~/lib/feed/groupConsecutiveReelClusters";
import { FEED_HIDE_ACTIONS, MEDIA_GRID } from "~/lib/feed/feedVideoCardLayout";
import { MediaGridSkeleton, ReelShelf } from "~/components/MediaShelf";
import EmptyState from "~/components/EmptyState";
import VideoCard from "~/routes/Home/components/VideoCard";
import type { FileType } from "~/lib/types";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Saved",
    description: "The videos and reels you saved. Only you can see them.",
    canonicalPath: "/saved",
    noindex: true,
  });

export const loader = async ({ request }: { request: Request }) => {
  const user = await isAuthenticated(request, ["id"]);
  if (!user?.id) return redirect("/auth/login?redirect=/saved");
  const page = await listSavedFiles(request, user.id, 0);
  return { files: page.files, nextOffset: page.nextOffset, currentUserId: user.id as string };
};

const emptyActions = { likedFileIds: new Set<string>(), dislikedFileIds: new Set<string>() };

export default function SavedPage() {
  const initial = useLoaderData<typeof loader>();
  const [files, setFiles] = useState<FileType[]>(initial.files);
  const [nextOffset, setNextOffset] = useState<number | null>(initial.nextOffset);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setFiles(initial.files);
    setNextOffset(initial.nextOffset);
  }, [initial]);

  useEffect(() => {
    const ids = files.map((f) => f.id);
    rememberSaves(ids, ids);
  }, [files]);

  const loadMore = useCallback(async () => {
    if (loading || nextOffset == null) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/saves?list=true&offset=${nextOffset}`, { credentials: "include" });
      if (!res.ok) throw new Error("load failed");
      const json = await res.json();
      const incoming: FileType[] = Array.isArray(json.data) ? json.data : [];
      setFiles((prev) => {
        const seen = new Set(prev.map((f) => f.id));
        return [...prev, ...incoming.filter((f) => !seen.has(f.id))];
      });
      setNextOffset(typeof json.nextOffset === "number" ? json.nextOffset : null);
    } catch {
      setNextOffset(null);
    } finally {
      setLoading(false);
    }
  }, [loading, nextOffset]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || nextOffset == null) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    }, { rootMargin: "600px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, nextOffset]);

  let index = 0;

  return (
    <div className="w-full max-w-full overflow-x-hidden">
      <div className="space-y-6 px-3 py-5 sm:px-5">
        <header className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            <Bookmark className="size-6" strokeWidth={1.75} aria-hidden />
            Saved
          </h1>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Lock className="size-3.5" aria-hidden />
            Only you can see what you save.
          </p>
        </header>

        {files.length === 0 ? (
          <EmptyState
            icon={Bookmark}
            title="Nothing saved yet"
            description="Tap Save on any video or reel to keep it here."
          />
        ) : (
          <div className={MEDIA_GRID}>
            {groupConsecutiveReelClusters(files).map((group) => {
              if (group.kind === "single") {
                const i = index++;
                return (
                  <VideoCard
                    key={group.file.id}
                    data={group.file}
                    index={i}
                    currentUserId={initial.currentUserId}
                    userActions={emptyActions}
                    hideActions={FEED_HIDE_ACTIONS}
                  />
                );
              }
              const startIndex = index;
              index += group.files.length;
              return (
                <ReelShelf
                  key={`reels-${group.files[0].id}`}
                  files={group.files}
                  label="Saved reels"
                  startIndex={startIndex}
                  currentUserId={initial.currentUserId}
                  userActions={emptyActions}
                  hideActions={FEED_HIDE_ACTIONS}
                />
              );
            })}
          </div>
        )}

        {loading ? <MediaGridSkeleton count={4} className={MEDIA_GRID} /> : null}
        {nextOffset != null ? <div ref={sentinelRef} className="h-10" aria-hidden /> : null}
      </div>
    </div>
  );
}
