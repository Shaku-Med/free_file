import { useState, useEffect, useCallback, useRef } from "react";
import EmptyState from "~/components/EmptyState";
import { Link, type MetaFunction } from "react-router";
import VideoCard from "~/routes/Home/components/VideoCard";
import type { FileType } from "~/lib/types";
import { groupConsecutiveReelClusters } from "~/lib/feed/groupConsecutiveReelClusters";
import { FEED_HIDE_ACTIONS, MEDIA_GRID } from "~/lib/feed/feedVideoCardLayout";
import { MediaGridSkeleton, ReelShelf, VideoCardSkeleton } from "~/components/MediaShelf";
import type { PlaylistCover } from "~/lib/playlist/playlistCovers.server";
import { Carousel, CarouselItem } from "~/components/Carousel/Carousel";
import { useFileContext } from "~/lib/Context/Context";
import { useLocalPlaylist } from "~/lib/hooks/useLocalPlaylist";
import { Button } from "~/components/ui/button";
import { buildPageMeta } from "~/lib/seo";
import { SignInToSeeMore } from "~/components/SignInWall";
import {
  Plus,
  ListVideo,
  Globe,
  Lock,
  Trash2,
  Bookmark,
  Music,
} from "lucide-react";
import CreatePlaylistModal from "~/components/Playlist/CreatePlaylistModal";
import { resolvePlaylistThumbSrc } from "~/lib/playlistImageUrl";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Playlists | Memories",
    description: "Your playlists and saved clips.",
    canonicalPath: "/playlist",
  });

interface ServerPlaylist {
  id: string;
  title: string;
  description?: string;
  is_public: boolean;
  unique_id: string;
  item_count: number;
  created_at: string;
  thumbnail_url?: string | null;
  first_thumb?: string | null;
  /** Newest listable item, resolved server side. */
  cover?: PlaylistCover | null;
}

const PLAYLIST_GRID =
  "grid w-full min-w-0 grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";

/** Playlist artwork with the stacked edge that says list rather than video. */
function PlaylistCard({ playlist }: { playlist: ServerPlaylist }) {
  const thumb = resolvePlaylistThumbSrc(playlist.thumbnail_url || playlist.first_thumb);
  return (
    <Link to={`/playlist/${playlist.id}`} className="group block min-w-0">
      <div className="relative pt-2">
        {/* Two offset slivers behind the artwork, the way a stack of cards sits. */}
        <div className="absolute inset-x-4 top-0 h-2 rounded-t-lg bg-muted/40" aria-hidden />
        <div className="absolute inset-x-2 top-1 h-2 rounded-t-lg bg-muted/70" aria-hidden />
        <div className="relative aspect-video overflow-hidden rounded-xl bg-muted">
          {playlist.cover ? (
            <VideoCard layout="notificationThumb" data={playlist.cover as unknown as FileType} />
          ) : thumb ? (
            <img
              src={thumb}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <ListVideo className="h-7 w-7 text-muted-foreground/60" aria-hidden />
            </div>
          )}
          <div className="absolute inset-y-0 right-0 flex w-[38%] flex-col items-center justify-center gap-1 bg-black/65 text-white">
            <span className="text-sm font-semibold tabular-nums">{playlist.item_count}</span>
            <ListVideo className="h-4 w-4" aria-hidden />
          </div>
        </div>
      </div>
      <p className="mt-2.5 line-clamp-2 text-sm font-medium leading-snug text-foreground">
        {playlist.title}
      </p>
      <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
        {playlist.is_public ? (
          <>
            <Globe className="h-3 w-3" aria-hidden /> Public
          </>
        ) : (
          <>
            <Lock className="h-3 w-3" aria-hidden /> Private
          </>
        )}
      </span>
    </Link>
  );
}

export default function PlaylistPage() {
  const { userId } = useFileContext();
  const { ids, count, clear } = useLocalPlaylist();
  const [files, setFiles] = useState<FileType[]>([]);
  const [serverPlaylists, setServerPlaylists] = useState<ServerPlaylist[]>([]);
  const [serverLoading, setServerLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [userActions, setUserActions] = useState<{ likedFileIds: Set<string>; dislikedFileIds: Set<string> }>({
    likedFileIds: new Set(),
    dislikedFileIds: new Set(),
  });
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const observerRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

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
          credentials: "include",
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
        loadingRef.current = false;
      }
    },
    [ids]
  );

  const handleFileUpdate = useCallback((fileId: string, updates: Partial<FileType>) => {
    setFiles((prev) =>
      prev.map((file) => (file.id === fileId ? { ...file, ...updates } : file))
    );
  }, []);

  useEffect(() => {
    if (ids.length === 0) {
      setFiles([]);
      setLoading(false);
      return;
    }
    fetchPage(1, false);
  }, [ids, fetchPage]);

  useEffect(() => {
    if (!userId) {
      setServerLoading(false);
      return;
    }
    setServerLoading(true);
    fetch('/api/playlists')
      .then(r => r.json())
      .then(json => setServerPlaylists(json.playlists || []))
      .catch(() => {})
      .finally(() => setServerLoading(false));
  }, [userId]);

  useEffect(() => {
    const el = observerRef.current;
    if (!el || !hasMore || loadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingRef.current) {
          loadingRef.current = true;
          fetchPage(page + 1, true);
        }
      },
      { threshold: 0.1, rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, page, fetchPage]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Playlists</h1>
        {userId && (
          <Button onClick={() => setCreateOpen(true)} size="sm" className="rounded-full gap-1.5">
            <Plus className="w-4 h-4" />
            New
          </Button>
        )}
      </div>

      {/* Server Playlists */}
      {userId && (
        <section>
          <h2 className="mb-4 text-base font-semibold text-foreground">Your lists</h2>
          {serverLoading ? (
            <MediaGridSkeleton variant="poster" count={5} className={PLAYLIST_GRID} />
          ) : serverPlaylists.length > 0 ? (
            <div className={PLAYLIST_GRID}>
              {serverPlaylists.map((pl) => (
                <PlaylistCard key={pl.id} playlist={pl} />
              ))}
            </div>
          ) : (
            <EmptyState
              variant="panel"
              icon={ListVideo}
              title="No playlists yet"
              action={
                <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
                  Create one
                </Button>
              }
            />
          )}
        </section>
      )}

      {/* Saved Locally */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Bookmark className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            Saved on this device
            <span className="text-sm font-normal text-muted-foreground">{count}</span>
          </h2>
          {count > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clear}
              className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear all
            </Button>
          )}
        </div>

        {loading ? (
          <MediaGridSkeleton count={8} className={MEDIA_GRID} />
        ) : files.length > 0 ? (
          <>
            <div className={MEDIA_GRID}>
              {(() => {
                const groups = groupConsecutiveReelClusters(files);
                let indexCounter = 0;
                return (
                  <>
                    {groups.map((g) => {
                      if (g.kind === "single") {
                        const file = g.file;
                        const index = indexCounter++;
                        return (
                          <VideoCard
                            key={file.id || file.unique_id || index}
                            data={file}
                            index={index}
                            currentUserId={userId || undefined}
                            userActions={userActions}
                            onUpdate={handleFileUpdate}
                            hideActions={{ completely: true }}
                          />
                        );
                      }
                      const clusterKey =
                        g.files[0]?.feed_reel_cluster_id ?? g.files[0]?.id ?? "saved-local";
                      const startIndex = indexCounter;
                      indexCounter += g.files.length;
                      return (
                        <ReelShelf
                          key={`saved-local-reel-${clusterKey}`}
                          files={g.files}
                          startIndex={startIndex}
                          currentUserId={userId || undefined}
                          userActions={userActions}
                          onUpdate={handleFileUpdate}
                          hideActions={FEED_HIDE_ACTIONS}
                        />
                      );
                    })}
                    {loadingMore &&
                      Array.from({ length: 4 }).map((_, i) => (
                        <VideoCardSkeleton key={`more-${i}`} />
                      ))}
                  </>
                );
              })()}
            </div>
            {hasMore && (
              userId ? (
                <div ref={observerRef} className="h-1" />
              ) : (
                <SignInToSeeMore />
              )
            )}
          </>
        ) : (
          <EmptyState
              variant="panel"
            icon={Bookmark}
            title="Nothing saved here"
            description="On any video open the menu, tap add to playlist, then save on this device."
            action={
              <Link to="/">
                <Button className="rounded-full px-6">Browse</Button>
              </Link>
            }
          />
        )}
      </section>

      <CreatePlaylistModal open={createOpen} onOpenChange={setCreateOpen} onCreated={(pl) => {
        setServerPlaylists(prev => [{ ...pl, description: undefined, is_public: true, item_count: 0, created_at: new Date().toISOString() }, ...prev]);
      }} />
    </div>
  );
}
