import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useFileContext } from "~/lib/Context/Context";
import OwnerProfile from "~/components/OwnerProfile/OwnerProfile";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Search, Users } from "lucide-react";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Subscriptions – Latest from channels you follow",
    description:
      "Watch new photos and videos from creators you subscribe to on Memories.",
    canonicalPath: "/subscriptions",
  });

type RecentUpload = {
  id: string;
  unique_id: string;
  file_title?: string;
  filename?: string;
  thumbnails?: string[] | null;
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

function recentUploadToFileType(u: RecentUpload, ch: ChannelRow): FileType {
  const thumbs = Array.isArray(u.thumbnails) ? u.thumbnails : [];
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
    thumbnails: thumbs,
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

  const cursorPos = 0;
  const { data: feed, error: feedErr } = await db.rpc("get_subscription_feed", {
    p_user_id: user.id,
    p_limit: 20,
    p_cursor_pos: cursorPos,
  });

  if (feedErr) {
    console.error("get_subscription_feed:", feedErr);
    return data({
      channels: (channelRows ?? []) as ChannelRow[],
      initialFeed: [],
      nextCursor: null,
      userActions: { likedFileIds: [], dislikedFileIds: [] },
      userId: user.id,
      error: "Failed to load feed",
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
  const nextCursor =
    rawCount > 0 ? { cursor_pos: cursorPos + rawCount } : null;

  return data({
    channels: (channelRows ?? []) as ChannelRow[],
    initialFeed,
    nextCursor,
    userActions: { likedFileIds, dislikedFileIds },
    userId: user.id,
    error: null as string | null,
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
        </div>
      </div>
    </div>
  );
}

export default function SubscriptionsPage() {
  const loaderData = useLoaderData<typeof loader>();
  const { userId: ctxUserId } = useFileContext();
  const nav = useNavigation();

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

  const userActions = useMemo(() => {
    const liked = new Set(loaderData.userActions?.likedFileIds ?? []);
    const disliked = new Set(loaderData.userActions?.dislikedFileIds ?? []);
    return { likedFileIds: liked, dislikedFileIds: disliked };
  }, [loaderData.userActions]);

  useEffect(() => {
    setFiles((loaderData.initialFeed ?? []) as unknown as FileType[]);
    setNextCursor(loaderData.nextCursor ?? null);
    setHasMore(Boolean(loaderData.nextCursor));
  }, [loaderData.initialFeed, loaderData.nextCursor]);

  const loadMore = useCallback(async () => {
    if (isLoading || !hasMore || !nextCursor) return;
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("cursor_pos", String(nextCursor.cursor_pos));
      const res = await fetch(`/api/subscription-feed?${params}`);
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
        if (entries[0]?.isIntersecting && !isLoading) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore, isLoading, nav.location]);

  if (loaderData.error === "Database unavailable") {
    return (
      <div className="max-w-lg mx-auto py-12 text-center text-muted-foreground text-sm">
        {loaderData.error}
      </div>
    );
  }

  return (
    <div className="w-full max-w-[2000px] mx-auto pb-6">
      {channels.length === 0 ? (
        <div className="rounded-xl border border-border bg-card/40 py-12 px-4 flex flex-col items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Users className="h-7 w-7 text-muted-foreground" />
          </div>
          <Button asChild variant="default" size="sm" className="rounded-full">
            <Link to="/search">
              <Search className="w-4 h-4 mr-2" />
              Discover channels
            </Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="flex gap-3 sm:gap-4 overflow-x-auto overflow-y-hidden pb-3 scroll-smooth -mx-0.5 px-0.5">
            {channels.map((ch) => (
              <Link
                key={ch.channel_id}
                to={`/profile/${ch.username}`}
                className="group flex shrink-0 flex-col items-center gap-1.5 w-[72px] sm:w-20"
              >
                <Avatar className="h-14 w-14 sm:h-16 sm:w-16 ring-2 ring-border group-hover:ring-primary transition-[box-shadow]">
                  <AvatarImage
                    src={getProfilePicUrl(ch.profile_pic)}
                    alt={ch.username}
                    loading="lazy"
                  />
                  <AvatarFallback className="text-base">
                    {ch.username.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-[11px] sm:text-xs font-medium text-center line-clamp-2 w-full text-foreground group-hover:text-primary leading-tight">
                  {ch.username}
                </span>
              </Link>
            ))}
          </div>

          {channels.map((ch, channelIndex) => {
            const recent = parseRecentUploads(ch.recent_uploads);
            if (recent.length === 0) return null;
            const owner = {
              id: ch.channel_id,
              username: ch.username,
              profile_pic: ch.profile_pic || "",
              verified: ch.verified,
              about: ch.about,
            };
            return (
              <div key={`shelf-${ch.channel_id}`} className="mb-6 last:mb-4">
                <div className="mb-2 pl-0.5">
                  <OwnerProfile owner={owner} size="md" showUsername />
                </div>
                <div className="flex gap-3 sm:gap-4 overflow-x-auto overflow-y-hidden pb-2 -mx-0.5 px-0.5 scroll-smooth">
                  {recent.map((u, uploadIndex) => {
                    const file = recentUploadToFileType(u, ch);
                    const idx = channelIndex * 32 + uploadIndex;
                    return (
                      <div
                        key={u.id}
                        className="shrink-0 w-[min(88vw,300px)] sm:w-[280px] md:w-[300px]"
                      >
                        <VideoCard
                          data={file}
                          index={idx}
                          currentUserId={userId || undefined}
                          userActions={userActions}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      )}

      {loaderData.error && loaderData.error !== "Database unavailable" && (
        <p className="text-sm text-destructive mb-3">{loaderData.error}</p>
      )}

      {files.length > 0 ? (
        <div className="mt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3 gap-3 sm:gap-4">
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
          {isLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 mt-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonCard key={`sk-${i}`} />
              ))}
            </div>
          )}
          <div ref={observerRef} className="h-8" />
        </div>
      ) : (
        channels.length > 0 && (
          <div className="rounded-lg border border-dashed border-border/80 py-10 text-center text-muted-foreground text-sm mt-2">
            Nothing new in your feed yet.
          </div>
        )
      )}
    </div>
  );
}
