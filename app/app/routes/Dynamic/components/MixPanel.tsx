import { useCallback, useEffect, useState } from "react";
import { useSearchParams, useParams, useNavigate, Link } from "react-router";
import { ListVideo, Loader2, Play } from "lucide-react";
import { isMixGid, mixWatchPath } from "~/lib/music/mixId";
import VideoCard from "~/routes/Home/components/VideoCard";
import type { FileType } from "~/lib/types";

/**
 * Watch-page mix queue.
 *
 * Replaces the old drag-to-reorder "Play queue" panel: YouTube has no such
 * thing in the sidebar — it has the current list. When the URL carries
 * `?list=RD…` this renders that mix, marks the track you're on, and pages in
 * more as you scroll. With no `?list=` it renders nothing and the sidebar falls
 * through to related videos, exactly like YouTube.
 */

const PAGE_SIZE = 20;

type MixResponse = {
  gid: string;
  seed?: { unique_id?: string; file_title?: string | null };
  items: FileType[];
  total: number;
  offset: number;
  hasMore: boolean;
};

/**
 * Module-level cache, keyed by list id.
 *
 * The sidebar swaps component trees at breakpoints, so resizing the window
 * UNMOUNTS and remounts this panel — any ref/state guard inside the component
 * dies with it, which is why the mix was refetching on every resize. Holding
 * the loaded pages out here means a remount rehydrates instantly and the
 * network is touched once per mix.
 *
 * Also survives navigating between tracks of the same mix, so clicking through
 * the queue never re-requests it.
 */
type MixCacheEntry = { items: FileType[]; total: number; hasMore: boolean };
const mixCache = new Map<string, MixCacheEntry>();
/** De-dupes concurrent first-loads (e.g. two panels mounted during a transition). */
const inflight = new Map<string, Promise<void>>();

export function MixPanel({ currentUserId }: { currentUserId?: string | null }) {
  const [searchParams] = useSearchParams();
  const params = useParams();
  const navigate = useNavigate();
  const gid = searchParams.get("list") ?? "";
  const currentUniqueId = String(params.uniqueId ?? params.id ?? "");

  const valid = isMixGid(gid);
  const cached = valid ? mixCache.get(gid) : undefined;

  // Seed straight from cache so a resize-remount paints with zero flicker and
  // zero network.
  const [items, setItems] = useState<FileType[]>(cached?.items ?? []);
  const [total, setTotal] = useState(cached?.total ?? 0);
  const [hasMore, setHasMore] = useState(cached?.hasMore ?? false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    async (offset: number, replace: boolean) => {
      if (!valid) return;
      setLoading(true);
      try {
        const res = await fetch(
          `/api/music/mix?list=${encodeURIComponent(gid)}&limit=${PAGE_SIZE}&offset=${offset}`,
          { credentials: "include" },
        );
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as MixResponse;
        const next = Array.isArray(body.items) ? body.items : [];
        setItems((prev) => {
          const merged = replace ? next : [...prev, ...next];
          mixCache.set(gid, {
            items: merged,
            total: Number(body.total) || 0,
            hasMore: Boolean(body.hasMore),
          });
          return merged;
        });
        setTotal(Number(body.total) || 0);
        setHasMore(Boolean(body.hasMore));
        setFailed(false);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [gid, valid],
  );

  // Fetch ONCE per list id. A cache hit (remount from a resize, or navigating
  // to another track in the same mix) skips the network entirely.
  useEffect(() => {
    if (!valid) return;
    const hit = mixCache.get(gid);
    if (hit) {
      setItems(hit.items);
      setTotal(hit.total);
      setHasMore(hit.hasMore);
      return;
    }
    if (inflight.has(gid)) return;
    const p = load(0, true).finally(() => inflight.delete(gid));
    inflight.set(gid, p);
  }, [gid, valid, load]);

  if (!valid) return null;
  if (failed && items.length === 0) return null;

  return (
    <section
      className="min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card/40"
      aria-label="Mix queue"
    >
      <header className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
        <ListVideo className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">Mix</p>
          <p className="truncate text-xs text-muted-foreground">
            {total > 0 ? `${items.length} of ${total}` : "Loading…"}
          </p>
        </div>
      </header>

      {/* Capped + scrollable so a 100-track mix can't push related videos off
          the page; matches the series section's shell. */}
      <div className="max-h-[26rem] overflow-y-auto overscroll-contain">
        <ul className="divide-y divide-border/40">
          {items.map((item, i) => {
            const uid = String(item.unique_id ?? "");
            const isCurrent = uid === currentUniqueId;
            return (
              <li key={item.id ?? uid ?? i} className="flex items-center gap-1 px-1.5 py-0.5">
                <span
                  className="w-5 shrink-0 text-center text-[11px] tabular-nums text-muted-foreground"
                  aria-hidden={isCurrent ? undefined : true}
                >
                  {isCurrent ? (
                    <Play className="mx-auto h-3 w-3 fill-current text-primary" aria-label="Now playing" />
                  ) : (
                    i + 1
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  {/* VideoCard owns thumbnail resolution (retries, legacy paths,
                      duration badge) — that's what its layouts are for. */}
                  <VideoCard
                    data={item}
                    layout="miniQueue"
                    queueActive={isCurrent}
                    onQueueSelect={() => navigate(mixWatchPath(uid, gid))}
                    currentUserId={currentUserId || undefined}
                  />
                </div>
              </li>
            );
          })}
        </ul>

        {/* Paging is gated to signed-in viewers (same rule the related-videos
            list already uses). Anonymous visitors still get the shared mix and
            the first page — they just can't page endlessly. */}
        {hasMore && currentUserId && (
          <div className="p-2">
            <button
              type="button"
              onClick={() => void load(items.length, false)}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading…
                </>
              ) : (
                "Show more"
              )}
            </button>
          </div>
        )}

        {hasMore && !currentUserId && (
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
