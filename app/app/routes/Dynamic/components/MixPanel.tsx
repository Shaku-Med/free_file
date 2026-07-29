import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useSearchParams, useParams, useNavigate, Link } from "react-router";
import { Loader2, Play } from "lucide-react";
import { cn, displayMediaTitle } from "~/lib/utils";
import { isMixGid, mixWatchPath } from "~/lib/music/mixId";
import {
  getMix,
  loadMix,
  mixArtists,
  subscribeMix,
  type MixState,
} from "~/lib/music/mixStore";
import VideoCard from "~/routes/Home/components/VideoCard";

/**
 * Watch-page mix queue.
 *
 * Replaces the old drag-to-reorder "Play queue": YouTube has no such sidebar
 * feature — it shows the list you're inside. Renders only when the URL carries
 * `?list=RD…`, otherwise the sidebar falls through to related videos.
 *
 * Reads from the shared mix store, so the sidebar, the player's auto-advance
 * and the server-preloaded loader data are all the same list — and a resize
 * (which remounts this component) costs zero fetches.
 */

const PAGE_SIZE = 20;
const EMPTY: MixState = { items: [], total: 0, hasMore: false };

function MixSkeleton() {
  return (
    <ul className="divide-y divide-border/40" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="flex items-center gap-2 px-2 py-2">
          <span className="h-3 w-3 shrink-0 rounded bg-muted animate-pulse" />
          <span className="aspect-video w-[5.5rem] shrink-0 rounded-md bg-muted animate-pulse" />
          <span className="min-w-0 flex-1 space-y-1.5">
            <span className="block h-3 w-[85%] rounded bg-muted animate-pulse" />
            <span className="block h-3 w-[55%] rounded bg-muted animate-pulse" />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function MixPanel({ currentUserId }: { currentUserId?: string | null }) {
  const [searchParams] = useSearchParams();
  const params = useParams();
  const navigate = useNavigate();
  const gid = searchParams.get("list") ?? "";
  const currentUniqueId = String(params.uniqueId ?? params.id ?? "");
  const valid = isMixGid(gid);

  // Subscribe to the shared store instead of holding a private copy, so the
  // panel repaints when the player pages in more of the mix.
  const state =
    useSyncExternalStore(
      subscribeMix,
      () => (valid ? getMix(gid) : undefined),
      () => undefined,
    ) ?? EMPTY;

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!valid || getMix(gid)) return;
    setLoading(true);
    void loadMix(gid, 0, PAGE_SIZE).finally(() => setLoading(false));
  }, [gid, valid]);

  const loadMore = useCallback(() => {
    if (!valid) return;
    setLoading(true);
    void loadMix(gid, state.items.length, PAGE_SIZE).finally(() =>
      setLoading(false),
    );
  }, [gid, valid, state.items.length]);

  if (!valid) return null;

  const first = state.items[0];
  // Title names the mix after its lead track, the way YouTube labels a mix
  // after the artist it was seeded from.
  const title = first
    ? `Mix - ${displayMediaTitle(first.file_title || first.filename || "")}`
    : "Mix";
  const artists = mixArtists(gid, 3);
  const showSkeleton = state.items.length === 0 && loading;

  if (state.items.length === 0 && !loading) return null;

  return (
    <section
      className="min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card/40"
      aria-label="Mix"
    >
      <header className="border-b border-border/60 px-3 py-2.5">
        <p className="truncate text-sm font-semibold text-foreground">{title}</p>
        {/* Who's in the mix, deduped — a far more useful subtitle than a track
            count, and each name links to that creator. */}
        {artists.length > 0 && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {artists.map((a, i) => (
              <span key={a.username}>
                {i > 0 && ", "}
                <Link
                  to={`/profile/${encodeURIComponent(a.username)}`}
                  className="hover:text-foreground hover:underline"
                >
                  @{a.username}
                </Link>
              </span>
            ))}
          </p>
        )}
      </header>

      <div className="max-h-[26rem] overflow-y-auto overscroll-contain">
        {showSkeleton ? (
          <MixSkeleton />
        ) : (
          <ul className="divide-y divide-border/40">
            {state.items.map((item, i) => {
              const uid = String(item.unique_id ?? "");
              const isCurrent = uid === currentUniqueId;
              return (
                <li
                  key={item.id ?? uid ?? i}
                  className="flex items-center gap-1 px-1.5 py-0.5"
                >
                  <span
                    className="w-5 shrink-0 text-center text-[11px] tabular-nums text-muted-foreground"
                    aria-hidden={isCurrent ? undefined : true}
                  >
                    {isCurrent ? (
                      <Play
                        className="mx-auto h-3 w-3 fill-current text-primary"
                        aria-label="Now playing"
                      />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    {/* VideoCard owns thumbnail resolution (retries, legacy
                        paths, duration badge) — that's what its layouts exist
                        for. Navigation is taken over so the list id and the
                        1-based index survive the click. */}
                    <VideoCard
                      data={item}
                      layout="miniQueue"
                      queueActive={isCurrent}
                      watchHref={mixWatchPath(uid, gid, { index: i + 1 })}
                      onQueueSelect={() =>
                        navigate(mixWatchPath(uid, gid, { index: i + 1 }))
                      }
                      currentUserId={currentUserId || undefined}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {state.hasMore && currentUserId && !showSkeleton && (
          <div className="p-2">
            <button
              type="button"
              onClick={loadMore}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading
                </>
              ) : (
                "Show more"
              )}
            </button>
          </div>
        )}

        {state.hasMore && !currentUserId && (
          <div className="px-3 py-3 text-center">
            <Link
              to="/auth/login"
              className="text-xs font-medium text-primary hover:underline"
            >
              Sign in to see more
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

export default MixPanel;
