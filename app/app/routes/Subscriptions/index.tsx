import { useCallback, useEffect, useRef, useState } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { A11y, Keyboard, Navigation, Pagination } from "swiper/modules";
import type { Swiper as SwiperType } from "swiper";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/pagination";
import {
  data,
  redirect,
  Link,
  useLoaderData,
  useNavigation,
  type MetaFunction,
} from "react-router";
import { buildPageMeta } from "~/lib/seo";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { filterFilesByAccess } from "~/routes/Api/fun/accessControl";
import { enrichFeedFilesWithInteractions } from "~/routes/Api/fun/enrichFeedFiles";
import VideoCard from "~/routes/Home/components/VideoCard";
import type { FileType } from "~/lib/types";
import { groupConsecutiveReelClusters } from "~/lib/feed/groupConsecutiveReelClusters";
import { useFileContext } from "~/lib/Context/Context";
import OwnerProfile from "~/components/OwnerProfile/OwnerProfile";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { ChevronLeft, ChevronRight, Search, Users } from "lucide-react";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Subscriptions – Latest from channels you follow",
    description:
      "Watch new photos and videos from creators you subscribe to on Memories.",
    canonicalPath: "/subscriptions",
  });

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type RecentUpload = {
  id: string;
  unique_id: string;
  file_title?: string;
  filename?: string;
  default_thumbnail?: string | null;
  endpoint?: string;
  file_type?: string;
  created_at?: string;
  duration?: number;
  is_reel?: boolean;
};

type ChannelRow = {
  channel_id: string;
  username: string;
  profile_pic: string | null;
  verified: boolean;
  about: string | null;
  notify: boolean;
  subscribed_at: string;
  subscriber_count: number;
  recent_uploads: unknown;
};

function parseRecentUploads(raw: unknown): RecentUpload[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as RecentUpload[];
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? (p as RecentUpload[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/* ------------------------------------------------------------------ */
/*  Channel avatar strip (still scrollable, it's just small avatars)   */
/* ------------------------------------------------------------------ */

const hideScrollbar =
  "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:h-0 [&::-webkit-scrollbar]:w-0";

function AvatarStrip({ channels }: { channels: ChannelRow[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const updateEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 2);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateEdges();
    const ro = new ResizeObserver(() => updateEdges());
    ro.observe(el);
    el.addEventListener("scroll", updateEdges, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", updateEdges);
    };
  }, [updateEdges, channels]);

  const scroll = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.75, behavior: "smooth" });
  };

  return (
    <div className="relative overflow-hidden">
      <div
        ref={scrollerRef}
        className={cn(
          "flex overflow-x-auto gap-4 sm:gap-5",
          hideScrollbar
        )}
      >
        {channels.map((ch) => (
          <Link
            key={ch.channel_id}
            to={`/profile/${ch.username}`}
            className="group flex shrink-0 flex-col items-center gap-1.5"
            style={{ width: "4.25rem" }}
          >
            <Avatar className="h-11 w-11 ring-[1.5px] ring-border transition-all group-hover:ring-primary sm:h-[3.25rem] sm:w-[3.25rem]">
              <AvatarImage
                src={getProfilePicUrl(ch.profile_pic)}
                alt={ch.username}
                loading="lazy"
              />
              <AvatarFallback className="text-sm font-medium">
                {ch.username.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="line-clamp-1 w-full text-center text-[11px] leading-tight text-muted-foreground group-hover:text-foreground transition-colors">
              {ch.username}
            </span>
          </Link>
        ))}
      </div>

      {canPrev && (
        <>
          <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-background to-transparent" />
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="absolute left-0.5 top-1/2 z-10 h-7 w-7 -translate-y-1/2 rounded-full shadow-md border border-border/50"
            onClick={() => scroll(-1)}
            aria-label="Scroll left"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
        </>
      )}

      {canNext && (
        <>
          <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent" />
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="absolute right-0.5 top-1/2 z-10 h-7 w-7 -translate-y-1/2 rounded-full shadow-md border border-border/50"
            onClick={() => scroll(1)}
            aria-label="Scroll right"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function recentUploadToFileType(u: RecentUpload, ch: ChannelRow): FileType {
  return {
    id: u.id,
    created_at: u.created_at || new Date(0).toISOString(),
    endpoint: u.endpoint || "",
    filename: u.filename || "",
    unique_id: u.unique_id,
    file_size: 0,
    file_type: u.file_type || "video/mp4",
    owner_id: ch.channel_id,
    is_public: true,
    file_title: u.file_title || "",
    default_thumbnail: u.default_thumbnail || null,
    view_count: 0,
    share_count: 0,
    like_count: 0,
    dislike_count: 0,
    comment_count: 0,
    duration: typeof u.duration === "number" ? u.duration : undefined,
    is_reel: Boolean(u.is_reel),
    owner: {
      id: ch.channel_id,
      username: ch.username,
      profile_pic: ch.profile_pic || "",
      verified: ch.verified,
      about: ch.about,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export const loader = async ({ request }: { request: Request }) => {
  const user = await isAuthenticated(request, ["id"]);
  if (!user?.id) {
    return redirect("/auth/login?redirect=/subscriptions");
  }

  if (!db) {
    return data(
      {
        channels: [] as ChannelRow[],
        initialFeed: [] as unknown[],
        nextCursor: null as { cursor_pos: number } | null,
        userActions: { likedFileIds: [] as string[], dislikedFileIds: [] as string[] },
        userId: user.id,
        error: "Database unavailable",
        shelfEnrichedById: {} as Record<string, FileType>,
      },
      { status: 503 }
    );
  }

  const { data: channelRows, error: chErr } = await db.rpc(
    "get_subscription_channels_recent_uploads",
    {
      p_user_id: user.id,
      p_recent_per_channel: 4,
      p_channels_limit: 200,
    }
  );

  if (chErr) {
    console.error("get_subscription_channels_recent_uploads:", chErr);
  }

  const channels = (channelRows ?? []) as ChannelRow[];

  const shelfInputs: Record<string, unknown>[] = [];
  for (const ch of channels) {
    for (const u of parseRecentUploads(ch.recent_uploads)) {
      if (!u?.id) continue;
      shelfInputs.push({
        id: u.id,
        created_at: u.created_at || new Date(0).toISOString(),
        endpoint: u.endpoint ?? "",
        filename: u.filename,
        unique_id: u.unique_id,
        file_size: 0,
        file_type: u.file_type ?? "video/mp4",
        is_adult: false,
        owner_id: ch.channel_id,
        is_public: true,
        file_title: u.file_title ?? "",
        default_thumbnail: u.default_thumbnail || null,
        view_count: 0,
        share_count: 0,
        is_reel: Boolean(u.is_reel),
        duration: u.duration,
        owner_username: ch.username,
        owner_profile_pic: ch.profile_pic,
        owner_verified: ch.verified,
        owner_about: ch.about,
        upload_status: "completed",
      });
    }
  }

  let shelfEnrichedById: Record<string, FileType> = {};
  let shelfLiked: string[] = [];
  let shelfDisliked: string[] = [];
  if (shelfInputs.length > 0) {
    const shelfResult = await enrichFeedFilesWithInteractions(db, shelfInputs, user.id);
    shelfLiked = shelfResult.likedFileIds;
    shelfDisliked = shelfResult.dislikedFileIds;
    for (const row of shelfResult.data) {
      const rid = row.id as string | undefined;
      if (rid) shelfEnrichedById[rid] = row as unknown as FileType;
    }
  }

  const cursorPos = 0;
  const { data: feed, error: feedErr } = await db.rpc("get_subscription_feed", {
    p_user_id: user.id,
    p_limit: 20,
    p_cursor_pos: cursorPos,
  });

  if (feedErr) {
    console.error("get_subscription_feed:", feedErr);
    return data({
      channels,
      initialFeed: [],
      nextCursor: null,
      userActions: { likedFileIds: shelfLiked, dislikedFileIds: shelfDisliked },
      userId: user.id,
      error: "Failed to load feed",
      shelfEnrichedById,
    });
  }

  const filteredFeed = await filterFilesByAccess(request, feed || []);
  const { data: initialFeed, likedFileIds, dislikedFileIds } =
    await enrichFeedFilesWithInteractions(
      db,
      filteredFeed as Record<string, unknown>[],
      user.id
    );

  const rawCount = (feed || []).length;
  const nextCursor = rawCount > 0 ? { cursor_pos: cursorPos + rawCount } : null;

  const mergedLiked = [...new Set([...likedFileIds, ...shelfLiked])];
  const mergedDisliked = [...new Set([...dislikedFileIds, ...shelfDisliked])];

  return data({
    channels,
    initialFeed,
    nextCursor,
    userActions: { likedFileIds: mergedLiked, dislikedFileIds: mergedDisliked },
    userId: user.id,
    error: null as string | null,
    shelfEnrichedById,
  });
};

/* ------------------------------------------------------------------ */
/*  Skeleton                                                           */
/* ------------------------------------------------------------------ */

function SkeletonCard() {
  return (
    <div className="animate-pulse">
      <div className="aspect-video bg-muted rounded-xl" />
      <div className="flex gap-3 mt-3">
        <div className="w-9 h-9 rounded-full bg-muted shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-muted rounded w-[85%]" />
          <div className="h-3 bg-muted rounded w-[60%]" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SubscriptionsPage() {
  const loaderData = useLoaderData<typeof loader>();
  const { userId: ctxUserId } = useFileContext();
  const nav = useNavigation();

  const shelfById = loaderData.shelfEnrichedById ?? {};
  const channels = loaderData.channels ?? [];
  const userId = loaderData.userId ?? ctxUserId ?? undefined;

  const [files, setFiles] = useState<FileType[]>(
    () => (loaderData.initialFeed ?? []) as unknown as FileType[]
  );
  const [nextCursor, setNextCursor] = useState<{ cursor_pos: number } | null>(
    loaderData.nextCursor ?? null
  );
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(Boolean(loaderData.nextCursor));
  const observerRef = useRef<HTMLDivElement | null>(null);

  const [userActions, setUserActions] = useState(() => ({
    likedFileIds: new Set(loaderData.userActions?.likedFileIds ?? []),
    dislikedFileIds: new Set(loaderData.userActions?.dislikedFileIds ?? []),
  }));

  useEffect(() => {
    setFiles((loaderData.initialFeed ?? []) as unknown as FileType[]);
    setNextCursor(loaderData.nextCursor ?? null);
    setHasMore(Boolean(loaderData.nextCursor));
    setUserActions({
      likedFileIds: new Set(loaderData.userActions?.likedFileIds ?? []),
      dislikedFileIds: new Set(loaderData.userActions?.dislikedFileIds ?? []),
    });
  }, [loaderData.initialFeed, loaderData.nextCursor, loaderData.userActions]);

  /* Infinite scroll */
  const loadMore = useCallback(async () => {
    if (isLoading || !hasMore || !nextCursor) return;
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("cursor_pos", String(nextCursor.cursor_pos));
      const res = await fetch(`/api/subscription-feed?${params}`, {
        credentials: "include",
      });
      if (!res.ok) {
        setHasMore(false);
        return;
      }
      const json = await res.json();
      const batch = (json?.data ?? []) as FileType[];
      if (batch.length > 0) {
        setFiles((prev) => {
          const seen = new Set(prev.map((f) => f.id));
          const merged = [...prev];
          for (const f of batch) {
            if (f.id && !seen.has(f.id)) {
              seen.add(f.id);
              merged.push(f);
            }
          }
          return merged;
        });
      }
      const newLiked = json?.userActions?.likedFileIds as string[] | undefined;
      const newDisliked = json?.userActions?.dislikedFileIds as string[] | undefined;
      if (newLiked?.length || newDisliked?.length) {
        setUserActions((prev) => {
          const liked = new Set(prev.likedFileIds);
          const disliked = new Set(prev.dislikedFileIds);
          for (const id of newLiked ?? []) liked.add(id);
          for (const id of newDisliked ?? []) disliked.add(id);
          return { likedFileIds: liked, dislikedFileIds: disliked };
        });
      }
      setNextCursor(json?.nextCursor ?? null);
      setHasMore(Boolean(json?.nextCursor));
    } catch (e) {
      console.error("subscription load more:", e);
      setHasMore(false);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, hasMore, nextCursor]);

  useEffect(() => {
    const el = observerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isLoading) loadMore();
      },
      { threshold: 0.1 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore, isLoading, nav.location]);

  /* ── Error state ── */
  if (loaderData.error === "Database unavailable") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 text-center text-sm text-muted-foreground">
        {loaderData.error}
      </div>
    );
  }

  /* ── Empty state ── */
  if (channels.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <div className="flex flex-col items-center gap-4 py-14 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Users className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-base font-medium text-foreground">
            No subscriptions yet
          </p>
          <p className="text-sm text-muted-foreground max-w-xs">
            Find creators you like and subscribe to see their latest uploads here.
          </p>
          <Button asChild variant="default" size="sm" className="mt-2 rounded-full">
            <Link to="/search">
              <Search className="mr-2 h-4 w-4" />
              Discover channels
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  /* ── Main layout ── */
  return (
    <div className="w-full max-w-full overflow-x-hidden">
      {/* Channel avatar strip */}
      <div className="border-b border-border/40 py-3 px-3 sm:px-5">
        <AvatarStrip channels={channels} />
      </div>

      {/* Content */}
      <div className="px-3 sm:px-5 py-5 space-y-8">
        {/* Per-channel 2x2 grids */}
        {channels.map((ch, channelIndex) => {
          const recent = parseRecentUploads(ch.recent_uploads).slice(0, 4);
          if (recent.length === 0) return null;
          const owner = {
            id: ch.channel_id,
            username: ch.username,
            profile_pic: ch.profile_pic || "",
            verified: ch.verified,
            about: ch.about,
          };
          return (
            <section key={`shelf-${ch.channel_id}`} className="space-y-2.5">
              <OwnerProfile
                owner={owner}
                size="md"
                showUsername
                className="max-w-full"
              />
              <div className="grid grid-cols-2 gap-3">
                {recent.map((u, uploadIndex) => {
                  const base = recentUploadToFileType(u, ch);
                  const enriched = u.id ? shelfById[u.id] : undefined;
                  const file = enriched
                    ? ({
                        ...base,
                        ...enriched,
                        owner: enriched.owner ?? base.owner,
                      } as FileType)
                    : base;
                  const idx = channelIndex * 32 + uploadIndex;
                  return (
                    <div key={u.id} className="min-w-0">
                      <VideoCard
                        data={file}
                        index={idx}
                        currentUserId={userId || undefined}
                        userActions={userActions}
                        hideActions={{completely: false}}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}

        {/* Error banner */}
        {loaderData.error && loaderData.error !== "Database unavailable" && (
          <p className="text-sm text-destructive">{loaderData.error}</p>
        )}

        {/* Full feed grid */}
        {files.length > 0 ? (
          <section>
            <h2 className="mb-4 text-base font-semibold text-foreground">
              Latest
            </h2>
            <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {(() => {
                const groups = groupConsecutiveReelClusters(files);
                let indexCounter = 0;
                return groups.map((g) => {
                  if (g.kind === "single") {
                    const file = g.file;
                    const index = indexCounter++;
                    return (
                      <div key={file.id || index} className="min-w-0">
                        <VideoCard
                          data={file}
                          index={index}
                          currentUserId={userId || undefined}
                          userActions={userActions}
                          hideActions={{completely: false}}
                        />
                      </div>
                    );
                  }
                  const clusterKey = g.files[0]?.feed_reel_cluster_id ?? g.files[0]?.id;
                  return (
                    <div
                      key={`reel-${clusterKey}`}
                      className="col-span-full w-full min-w-0 max-w-full overflow-hidden"
                    >
                      <Swiper
                        modules={[Navigation, Pagination, A11y, Keyboard]}
                        slidesPerView={1.15}
                        spaceBetween={10}
                        speed={380}
                        watchOverflow
                        observer
                        observeParents
                        resizeObserver
                        navigation
                        keyboard={{ enabled: true, onlyInViewport: true }}
                        pagination={{
                          clickable: true,
                          dynamicBullets: g.files.length > 5,
                        }}
                        breakpoints={{
                          640: { slidesPerView: 2.5, spaceBetween: 12 },
                          768: { slidesPerView: 3, spaceBetween: 12 },
                          1024: { slidesPerView: 3.5, spaceBetween: 14 },
                          1280: { slidesPerView: 4, spaceBetween: 14 },
                          1536: { slidesPerView: 5, spaceBetween: 16 },
                        }}
                        className="feed-reel-swiper"
                        onInit={(swiper: SwiperType) => {
                          swiper.update();
                        }}
                      >
                        {g.files.map((file) => {
                          const index = indexCounter++;
                          return (
                            <SwiperSlide key={file.id || file.unique_id} className="!h-auto">
                              <VideoCard
                                data={file}
                                layout="reelStrip"
                                index={index}
                                currentUserId={userId || undefined}
                                userActions={userActions}
                                hideActions={{completely: false}}
                              />
                            </SwiperSlide>
                          );
                        })}
                      </Swiper>
                    </div>
                  );
                });
              })()}
            </div>

            {isLoading && (
              <div className="mt-6 grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <SkeletonCard key={`sk-${i}`} />
                ))}
              </div>
            )}
            <div ref={observerRef} className="h-8" />
          </section>
        ) : (
          <div className="rounded-xl border border-dashed border-border/60 py-10 text-center text-sm text-muted-foreground">
            Nothing new in your feed yet.
          </div>
        )}
      </div>
    </div>
  );
}