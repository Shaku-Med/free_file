import { useEffect, useMemo, useState } from "react";
import { Link, useParams, type MetaFunction } from "react-router";
import { Music2 } from "lucide-react";
import VideoCard from "~/routes/Home/components/VideoCard";
import Actions from "~/routes/Home/components/VideoCard/Actions";
import WatchLink from "~/components/WatchLink";
import OwnerProfile from "~/components/OwnerProfile/OwnerProfile";
import EmptyState from "~/components/EmptyState";
import { Button } from "~/components/ui/button";
import { useFileContext } from "~/lib/Context/Context";
import { cn, displayMediaTitle } from "~/lib/utils";
import ParseFilenameInsert from "~/lib/utils/ShowFileName";
import { formatNumber } from "~/lib/utils/formatNumber";
import { formatTimeAgo } from "~/lib/formatTimeAgo";
import { buildPageMeta } from "~/lib/seo";
import { type FileType, fileWatchPath } from "~/lib/types";

/** Match `BodyComponent` / footer horizontal padding. */
const PAGE_SHELL = "mx-auto w-full min-w-0 px-3 sm:px-5 lg:px-8 xl:px-4";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Sound | Memories",
    description: "See the original clip and every video that uses this sound.",
    canonicalPath: "/music",
  });

type MusicPageData = {
  original: FileType | null;
  uses: FileType[];
  userActions?: { likedFileIds: string[]; dislikedFileIds: string[] };
  originalInteractions?: {
    like_count: number;
    dislike_count: number;
    comment_count: number;
  } | null;
};

function HeroSkeleton() {
  return (
    <div className="grid animate-pulse gap-6 lg:grid-cols-[minmax(0,18rem)_1fr]">
      <div className="aspect-video w-full max-w-md rounded-xl bg-muted" />
      <div className="min-w-0 space-y-4">
        <div className="h-4 w-28 rounded bg-muted" />
        <div className="h-8 w-full max-w-lg rounded bg-muted" />
        <div className="h-10 w-48 rounded bg-muted" />
        <div className="h-24 w-full rounded-xl bg-muted" />
      </div>
    </div>
  );
}

function SoundOriginalMeta({
  file,
  userId,
  userActions,
  interactions,
}: {
  file: FileType;
  userId?: string | null;
  userActions: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
  interactions: { like_count: number; dislike_count: number; comment_count: number } | null;
}) {
  const views = Number((file as { views?: unknown }).views ?? file.view_count ?? 0);

  const fileId = String(file.id ?? "");
  const idKey = fileId.toLowerCase();
  const liked = userActions.likedFileIds.has(idKey) || userActions.likedFileIds.has(fileId);
  const disliked = userActions.dislikedFileIds.has(idKey) || userActions.dislikedFileIds.has(fileId);
  const isOwner = Boolean(userId && file.owner_id && userId === file.owner_id);
  const likeCount =
    interactions?.like_count ??
    (Number(file.like_count ?? file.up_count) || 0);
  const dislikeCount =
    interactions?.dislike_count ??
    (Number(file.dislike_count ?? file.down_count) || 0);
  const commentCount =
    interactions?.comment_count ?? (Number(file.comment_count) || 0);
  const watchPath = fileWatchPath(file);

  return (
    <div className="min-w-0 flex-1 space-y-4">
      <p className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Music2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Original sound
      </p>

      <h1 className="text-xl font-bold leading-tight text-foreground sm:text-2xl">
        <ParseFilenameInsert filename={displayMediaTitle(file.file_title || file.filename || "")} />
      </h1>

      {file.owner ? (
        <div className="flex min-w-0 items-center gap-3">
          <OwnerProfile owner={file.owner} size="md" showUsername={false} />
          <div className="min-w-0">
            <Link
              to={`/profile/${file.owner.username}`}
              className="block truncate font-semibold text-foreground transition-colors hover:text-primary"
            >
              {file.owner.username}
            </Link>
          </div>
        </div>
      ) : null}

      <Actions
        fileId={fileId}
        uniqueId={file.unique_id}
        sharePagePath={watchPath}
        likeCount={likeCount}
        dislikeCount={dislikeCount}
        commentCount={commentCount}
        liked={liked}
        disliked={disliked}
        isOwner={isOwner}
        currentUserId={userId ?? undefined}
        fileOwnerId={file.owner_id || undefined}
        isAdult={Boolean(file.is_adult)}
        commentsEnabled={file.comments_enabled !== false}
        fileCreatedAt={file.created_at}
      />

      <div className="rounded-xl bg-muted/40 px-3 py-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground">
          <span className="font-semibold tabular-nums">{formatNumber(views)} views</span>
          {file.created_at ? (
            <span className="font-semibold">{formatTimeAgo(file.created_at)}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Sound page (`/music/:id` where :id = the ORIGINAL file's id).
 */
export default function MusicPage() {
  const params = useParams();
  const { userId } = useFileContext();
  const id = params.id ?? "";

  const [data, setData] = useState<MusicPageData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setData(null);
    fetch(`/api/music/${encodeURIComponent(id)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return;
        setData(j && !j.error ? (j as MusicPageData) : { original: null, uses: [] });
      })
      .catch(() => {
        if (alive) setData({ original: null, uses: [] });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const original = data?.original ?? null;
  const uses = data?.uses ?? [];

  const userActions = useMemo(
    () => ({
      likedFileIds: new Set(data?.userActions?.likedFileIds ?? []),
      dislikedFileIds: new Set(data?.userActions?.dislikedFileIds ?? []),
    }),
    [data?.userActions],
  );

  const useCountLabel = useMemo(() => {
    const n = uses.length;
    if (n === 0) return "No videos yet";
    if (n === 1) return "1 video";
    return `${formatNumber(n)}${n >= 60 ? "+" : ""} videos`;
  }, [uses.length]);

  return (
    <div className={cn(PAGE_SHELL, "py-6 sm:py-8")}>
      <section className="mb-8 overflow-hidden rounded-2xl border border-border/50 bg-card/40 p-4 sm:p-6">
        {loading ? (
          <HeroSkeleton />
        ) : original ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_1fr] lg:items-start">
            <WatchLink
              to={fileWatchPath(original)}
              className="mx-auto block w-full max-w-md shrink-0 lg:mx-0"
            >
              <div className="aspect-video w-full overflow-hidden rounded-xl ring-1 ring-border/40">
                <VideoCard
                  data={original}
                  layout="notificationThumb"
                  index={0}
                  hideActions={{ completely: true }}
                />
              </div>
            </WatchLink>

            <SoundOriginalMeta
              file={original}
              userId={userId}
              userActions={userActions}
              interactions={data?.originalInteractions ?? null}
            />
          </div>
        ) : (
          <EmptyState
            icon={Music2}
            title="This sound isn't available"
            description="It may have been removed or set to private."
            action={
              <Button asChild variant="outline" size="sm" className="rounded-full">
                <Link to="/">Back to home</Link>
              </Button>
            }
            className="py-10"
          />
        )}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
            Made with this sound
          </h2>
          {!loading ? (
            <span className="text-sm text-muted-foreground">{useCountLabel}</span>
          ) : null}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="animate-pulse space-y-3">
                <div className="aspect-video rounded-xl bg-muted" />
                <div className="h-4 w-3/4 rounded bg-muted" />
                <div className="h-3 w-1/2 rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : uses.length > 0 ? (
          <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
            {uses.map((file, index) => (
              <VideoCard
                key={file.id ?? index}
                data={file}
                index={index}
                currentUserId={userId ?? undefined}
                userActions={userActions}
                hideActions={{ completely: true }}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Music2}
            title="Nothing here yet"
            description="When someone uploads a video with this sound, it'll show up here."
            action={
              <Button asChild variant="outline" size="sm" className="rounded-full">
                <Link to="/">Browse the feed</Link>
              </Button>
            }
          />
        )}
      </section>
    </div>
  );
}
