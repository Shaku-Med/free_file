import { useEffect, useState } from "react";
import { Link, useParams, type MetaFunction } from "react-router";
import { Music2, Play } from "lucide-react";
import VideoCard from "~/routes/Home/components/VideoCard";
import WatchLink from "~/components/WatchLink";
import { useFileContext } from "~/lib/Context/Context";
import { getThumbnailUrl } from "~/lib/utils";
import { formatNumber } from "~/lib/utils/formatNumber";
import { buildPageMeta } from "~/lib/seo";
import type { FileType } from "~/lib/types";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Music | Memories",
    description: "All the videos using this sound on Memories.",
    canonicalPath: "/music",
  });

type MusicPageData = {
  original: FileType | null;
  uses: FileType[];
};

function HeroSkeleton() {
  return (
    <div className="flex animate-pulse items-center gap-4">
      <div className="h-28 w-28 shrink-0 rounded-xl bg-muted" />
      <div className="flex-1 space-y-3">
        <div className="h-5 w-1/2 rounded bg-muted" />
        <div className="h-4 w-1/3 rounded bg-muted" />
        <div className="h-8 w-36 rounded-full bg-muted" />
      </div>
    </div>
  );
}

/**
 * Sound page (`/music/:id` where :id = the ORIGINAL file's id): the original
 * content as the hero + every video whose audio fingerprint matched it
 * the platform's version of YouTube's "shorts remixing this video".
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
    fetch(`/api/music/${encodeURIComponent(id)}`)
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
  const originalTitle =
    original?.file_title?.trim() ||
    (original?.filename || "").replace(/\.[^./\\]+$/, "") ||
    "Original content";

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Hero: the original content this sound belongs to */}
      <div className="mb-8 rounded-2xl border border-border/50 bg-muted/30 p-4 sm:p-6">
        {loading ? (
          <HeroSkeleton />
        ) : original ? (
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <WatchLink
              to={`/${encodeURIComponent(original.unique_id)}`}
              className="group relative block h-28 w-28 shrink-0 overflow-hidden rounded-xl bg-muted"
            >
              <img
                src={getThumbnailUrl(original, { queryString: "?quality=50" })}
                alt=""
                className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
              />
              <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/30">
                <Play className="h-8 w-8 text-white opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
              </span>
            </WatchLink>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Music2 className="h-3.5 w-3.5" aria-hidden />
                Original content
              </p>
              <h1 className="mt-1 truncate text-xl font-bold text-foreground sm:text-2xl">
                {originalTitle}
              </h1>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">
                {original.owner?.username ? `${original.owner.username} · ` : ""}
                {formatNumber(Number(original.view_count) || 0)} views
              </p>
              <WatchLink
                to={`/${encodeURIComponent(original.unique_id)}`}
                className="mt-3 inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background transition-colors hover:bg-foreground/90"
              >
                <Play className="h-4 w-4" aria-hidden />
                Watch original
              </WatchLink>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-muted-foreground">
            <Music2 className="h-6 w-6" aria-hidden />
            <p className="text-sm">The original content for this sound isn't available.</p>
          </div>
        )}
      </div>

      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-foreground">Videos using this sound</h2>
        {!loading && (
          <span className="text-sm tabular-nums text-muted-foreground">
            {uses.length}
            {uses.length >= 60 ? "+" : ""}
          </span>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="aspect-video rounded-xl bg-muted" />
              <div className="mt-3 h-4 w-3/4 rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : uses.length > 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {uses.map((file, index) => (
            <VideoCard
              key={file.id ?? index}
              data={file}
              index={index}
              currentUserId={userId ?? undefined}
              userActions={{ likedFileIds: new Set<string>(), dislikedFileIds: new Set<string>() }}
              hideActions={{ completely: false }}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Music2 className="mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
          <h3 className="text-lg font-semibold text-foreground">No videos use this sound yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Be the first  upload something with it.
          </p>
          <Link to="/" className="mt-4 text-sm text-primary hover:underline">
            Back to feed
          </Link>
        </div>
      )}
    </div>
  );
}
