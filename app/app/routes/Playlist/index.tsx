import { useState, useEffect, useCallback, useRef } from "react";
import { Link, type MetaFunction } from "react-router";
import VideoCard from "~/routes/Home/components/VideoCard";
import type { FileType } from "~/lib/types";
import { groupConsecutiveReelClusters } from "~/lib/feed/groupConsecutiveReelClusters";
import { Swiper, SwiperSlide } from "swiper/react";
import { Navigation, A11y, Keyboard } from "swiper/modules";
import type { Swiper as SwiperType } from "swiper";
import "swiper/css";
import "swiper/css/navigation";
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
}

export default function PlaylistPage() {
  const playlistGridClass =
    "grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3";
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

  const savedVideoGridClass =
    "grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3";

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
    <div className="space-y-10 px-2">
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
          <h2 className="text-base font-semibold mb-4 text-muted-foreground">Your lists</h2>
          {serverLoading ? (
            <div className={playlistGridClass}>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="animate-pulse rounded-xl border bg-card overflow-hidden">
                  <div className="aspect-video bg-muted" />
                  <div className="p-3 h-14 bg-muted/40" />
                </div>
              ))}
            </div>
          ) : serverPlaylists.length > 0 ? (
            <div className="grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {serverPlaylists.map((pl) => {
                const thumb = resolvePlaylistThumbSrc(pl.thumbnail_url || pl.first_thumb);
                return (
                  <Link
                    key={pl.id}
                    to={`/playlist/${pl.id}`}
                    className="group block rounded-xl border bg-card overflow-hidden hover:border-primary/30 hover:bg-accent/40 transition-colors"
                  >
                    <div className="relative aspect-video bg-muted overflow-hidden">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                          loading="lazy"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/15 to-muted">
                          <Music className="w-12 h-12 text-primary/70" aria-hidden />
                        </div>
                      )}
                      <span className="absolute bottom-2 right-2 rounded-md bg-black/65 px-2 py-0.5 text-[11px] font-medium text-white">
                        {pl.item_count === 1 ? "1 video" : `${pl.item_count} videos`}
                      </span>
                    </div>
                    <div className="p-3 min-w-0">
                      <p className="font-medium text-sm line-clamp-2 group-hover:text-primary transition-colors">{pl.title}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1.5">
                        {pl.is_public ? (
                          <span className="inline-flex items-center gap-0.5"><Globe className="w-3 h-3" /> Public</span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5"><Lock className="w-3 h-3" /> Private</span>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <ListVideo className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No playlists yet</p>
              <Button variant="link" size="sm" onClick={() => setCreateOpen(true)} className="mt-1 text-primary">
                Create one
              </Button>
            </div>
          )}
        </section>
      )}

      {/* Saved Locally */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-muted-foreground flex items-center gap-2">
            <Bookmark className="w-5 h-5 shrink-0 opacity-80" />
            Saved on this device
            <span className="text-sm font-normal opacity-80">({count})</span>
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
          <div className={savedVideoGridClass}>
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : files.length > 0 ? (
          <>
            <div className={savedVideoGridClass}>
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
                      return (
                        <div
                          key={`saved-local-reel-${clusterKey}`}
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
                                    currentUserId={userId || undefined}
                                    userActions={userActions}
                                    onUpdate={handleFileUpdate}
                                    hideActions={{ completely: false, halfway: true }}
                                  />
                                </SwiperSlide>
                              );
                            })}
                          </Swiper>
                        </div>
                      );
                    })}
                    {loadingMore &&
                      Array.from({ length: 4 }).map((_, i) => (
                        <SkeletonCard key={`more-${i}`} />
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
          <div className="flex items-center flex-col justify-center py-16 rounded-xl border border-dashed">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
              <Bookmark className="w-7 h-7 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Nothing saved here</h3>
            <p className="text-sm text-muted-foreground mb-5 text-center max-w-sm leading-relaxed">
              On any video open the menu, tap add to playlist, then choose save on this device.
            </p>
            <Link to="/">
              <Button variant="default" className="rounded-full px-6">
                Browse
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
