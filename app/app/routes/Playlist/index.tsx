import { useState, useEffect, useCallback, useRef } from "react";
import { Link, type MetaFunction } from "react-router";
import VideoCard from "~/routes/Home/components/VideoCard";
import type { FileType } from "~/lib/types";
import { useFileContext } from "~/lib/Context/Context";
import { useLocalPlaylist } from "~/lib/hooks/useLocalPlaylist";
import { Button } from "~/components/ui/button";
import { buildPageMeta } from "~/lib/seo";
import {
  Plus,
  ListVideo,
  Globe,
  Lock,
  Trash2,
  Bookmark,
  Music,
  ChevronRight,
} from "lucide-react";
import CreatePlaylistModal from "~/components/Playlist/CreatePlaylistModal";

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

function SkeletonPlaylistCard() {
  return (
    <div className="animate-pulse flex items-center gap-3 p-3 rounded-xl bg-card border">
      <div className="w-12 h-12 rounded-lg bg-muted shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-muted rounded w-[70%]" />
        <div className="h-3 bg-muted rounded w-[40%]" />
      </div>
    </div>
  );
}

interface ServerPlaylist {
  id: string;
  title: string;
  description?: string;
  is_public: boolean;
  unique_id: string;
  item_count: number;
  created_at: string;
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
    <div className="space-y-8 px-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Playlists</h1>
        </div>
        {userId && (
          <Button onClick={() => setCreateOpen(true)} size="sm" className="rounded-full gap-1.5">
            <Plus className="w-4 h-4" />
            New playlist
          </Button>
        )}
      </div>

      {/* Server Playlists */}
      {userId && (
        <section>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <ListVideo className="w-5 h-5 text-muted-foreground" />
            My Playlists
          </h2>
          {serverLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonPlaylistCard key={i} />
              ))}
            </div>
          ) : serverPlaylists.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {serverPlaylists.map((pl) => (
                <Link
                  key={pl.id}
                  to={`/playlist/${pl.id}`}
                  className="group flex items-center gap-3 p-3 rounded-xl bg-card hover:bg-accent/50 transition-colors border"
                >
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
                    <Music className="w-5 h-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">{pl.title}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                      <span>{pl.item_count} {pl.item_count === 1 ? "item" : "items"}</span>
                      <span className="text-muted-foreground/50">·</span>
                      {pl.is_public ? (
                        <span className="inline-flex items-center gap-0.5"><Globe className="w-3 h-3" /> Public</span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5"><Lock className="w-3 h-3" /> Private</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors shrink-0" />
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-6 text-center">
              <ListVideo className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No playlists yet</p>
              <Button variant="link" size="sm" onClick={() => setCreateOpen(true)} className="mt-1 text-primary">
                Create your first playlist
              </Button>
            </div>
          )}
        </section>
      )}

      {/* Saved Locally */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Bookmark className="w-5 h-5 text-muted-foreground" />
            Saved Locally
            <span className="text-sm font-normal text-muted-foreground ml-1">
              ({count})
            </span>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : files.length > 0 ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3 gap-4">
              {files.map((file, index) => (
                <VideoCard
                  key={file.id || index}
                  data={file}
                  index={index}
                  currentUserId={userId || undefined}
                  userActions={userActions}
                />
              ))}
              {loadingMore &&
                Array.from({ length: 4 }).map((_, i) => (
                  <SkeletonCard key={`more-${i}`} />
                ))
              }
            </div>
            {hasMore && <div ref={observerRef} className="h-1" />}
          </>
        ) : (
          <div className="flex items-center flex-col justify-center py-16 rounded-xl border border-dashed">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
              <Bookmark className="w-7 h-7 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-1">No saved videos</h3>
            <p className="text-sm text-muted-foreground mb-5 text-center max-w-sm">
              Open <span className="font-medium text-foreground">⋯</span> on a video →{" "}
              <span className="font-medium text-foreground">Add to playlist</span> →{" "}
              <span className="font-medium text-foreground">Save locally on this device</span>
            </p>
            <Link to="/">
              <Button variant="default" className="rounded-full px-6">
                Browse content
              </Button>
            </Link>
          </div>
        )}
      </section>

      <CreatePlaylistModal open={createOpen} onOpenChange={setCreateOpen} onCreated={(pl) => {
        setServerPlaylists(prev => [{ ...pl, description: undefined, is_public: true, item_count: 0, created_at: new Date().toISOString() }, ...prev]);
      }} />
    </div>
  );
}
