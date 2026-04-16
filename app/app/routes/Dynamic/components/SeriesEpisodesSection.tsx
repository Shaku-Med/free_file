import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { SeriesEpisodeGroup } from "~/lib/types";
import VideoCard from "~/routes/Home/components/VideoCard";
import { ChevronRight, Layers } from "lucide-react";
import { cn } from "~/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";

/** Thread geometry (Facebook-style spine + elbow) */
const SPINE_LEFT = "left-[15px]";
const CONNECTOR_TOP = "top-[22px]";
const THREAD_PL = "pl-[30px]";

function countEpisodeItems(ep: SeriesEpisodeGroup): number {
  let n = ep.items.length;
  if (ep.nested?.length) {
    for (const c of ep.nested) n += countEpisodeItems(c);
  }
  return n;
}

function collectEpisodeIds(eps: SeriesEpisodeGroup[], out: string[] = []): string[] {
  for (const ep of eps) {
    out.push(ep.episode_id);
    if (ep.nested?.length) collectEpisodeIds(ep.nested, out);
  }
  return out;
}

function subtreeContainsCurrent(ep: SeriesEpisodeGroup, currentUniqueId: string): boolean {
  if (ep.items.some((i) => i.unique_id === currentUniqueId)) return true;
  if (!ep.nested?.length) return false;
  return ep.nested.some((c) => subtreeContainsCurrent(c, currentUniqueId));
}

function markOpenForCurrent(
  eps: SeriesEpisodeGroup[],
  currentUniqueId: string,
  m: Record<string, boolean>
): void {
  for (const ep of eps) {
    if (subtreeContainsCurrent(ep, currentUniqueId)) {
      m[ep.episode_id] = true;
      if (ep.nested?.length) markOpenForCurrent(ep.nested, currentUniqueId, m);
    }
  }
}

function buildEpisodeOpenInitial(
  eps: SeriesEpisodeGroup[],
  currentUniqueId: string
): Record<string, boolean> {
  const m: Record<string, boolean> = {};
  markOpenForCurrent(eps, currentUniqueId, m);
  if (eps.length && !Object.values(m).some(Boolean)) {
    m[eps[0].episode_id] = true;
  }
  return m;
}

interface SeriesEpisodesSectionProps {
  episodes: SeriesEpisodeGroup[];
  currentVideoUniqueId: string;
  currentUserId?: string;
  userActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
}

/** Vertical spine + per-row elbow (rounded └) like FB comment threads */
function NestedEpisodeThread({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className={cn("relative mt-3", THREAD_PL)}>
      {/* Continuous vertical line */}
      <div
        className={cn(
          "pointer-events-none absolute bottom-0 top-0 w-[2px] rounded-full",
          SPINE_LEFT,
          "bg-muted-foreground/22 dark:bg-muted-foreground/30"
        )}
        aria-hidden
      />
      <ul className="m-0 list-none space-y-3 p-0">{children}</ul>
    </div>
  );
}

function NestedEpisodeRow({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <li className="relative min-w-0 pt-0.5">
      {/* Rounded inner corner (└) where spine meets row */}
      <div
        className={cn(
          "pointer-events-none absolute z-0 h-[11px] w-[11px] border-l-2 border-b-2 border-muted-foreground/22",
          "rounded-bl-[10px] dark:border-muted-foreground/30",
          SPINE_LEFT,
          "top-[21px] -translate-y-full"
        )}
        aria-hidden
      />
      {/* Horizontal segment toward the card */}
      <div
        className={cn(
          "pointer-events-none absolute z-0 h-[2px] w-[12px] rounded-r-full bg-muted-foreground/22 dark:bg-muted-foreground/30",
          SPINE_LEFT,
          CONNECTOR_TOP
        )}
        aria-hidden
      />
      <div className="relative z-[1] min-w-0">{children}</div>
    </li>
  );
}

function EpisodeBlock({
  ep,
  depth,
  currentVideoUniqueId,
  currentUserId,
  userActions,
  episodeOpen,
  setEpisodeOpen,
}: {
  ep: SeriesEpisodeGroup;
  depth: number;
  currentVideoUniqueId: string;
  currentUserId?: string;
  userActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
  episodeOpen: Record<string, boolean>;
  setEpisodeOpen: Dispatch<SetStateAction<Record<string, boolean>>>;
}) {
  const label = ep.episode_name?.trim() || "Episode";
  const part =
    ep.episode_number != null && !Number.isNaN(ep.episode_number)
      ? `Part ${ep.episode_number}`
      : null;
  const nestedCount = ep.nested?.length ?? 0;
  const totalVideos = countEpisodeItems(ep);

  const isRoot = depth === 0;

  const block = (
    <Collapsible
      open={!!episodeOpen[ep.episode_id]}
      onOpenChange={(next) =>
        setEpisodeOpen((prev) => ({ ...prev, [ep.episode_id]: next }))
      }
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors",
            "hover:bg-muted/45 active:scale-[0.998]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset",
            "data-[state=open]:bg-muted/30",
            !isRoot && "py-2"
          )}
        >
          <ChevronRight
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out",
              episodeOpen[ep.episode_id] && "rotate-90"
            )}
            strokeWidth={2}
            aria-hidden
          />
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
            <span className="truncate text-[14px] font-medium leading-snug text-foreground">
              {label}
            </span>
            <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
              {[part, `${totalVideos} video${totalVideos === 1 ? "" : "s"}`]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-3 px-3 pb-3 pt-1">
          <div
            className={cn(
              "overflow-hidden rounded-lg border border-border/35 bg-background/50",
              "py-1.5 pl-2 pr-1.5"
            )}
          >
            {ep.items.map((video, index) => {
              const isCurrent = video.unique_id === currentVideoUniqueId;
              return (
                <div
                  key={video.unique_id}
                  className={cn(
                    "rounded-md transition-colors",
                    isCurrent && "bg-primary/[0.07] ring-1 ring-primary/18"
                  )}
                >
                  <VideoCard
                    layout="horizontal"
                    data={video}
                    index={index}
                    currentUserId={currentUserId}
                    userActions={userActions}
                  />
                </div>
              );
            })}
          </div>
          {nestedCount > 0 && ep.nested && (
            <NestedEpisodeThread>
              {ep.nested.map((child) => (
                <NestedEpisodeRow key={child.episode_id}>
                  <div
                    className={cn(
                      "overflow-hidden rounded-xl border border-border/45 bg-muted/15",
                      "shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                    )}
                  >
                    <EpisodeBlock
                      ep={child}
                      depth={depth + 1}
                      currentVideoUniqueId={currentVideoUniqueId}
                      currentUserId={currentUserId}
                      userActions={userActions}
                      episodeOpen={episodeOpen}
                      setEpisodeOpen={setEpisodeOpen}
                    />
                  </div>
                </NestedEpisodeRow>
              ))}
            </NestedEpisodeThread>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );

  if (isRoot) {
    return (
      <li className="min-w-0 list-none">
        <div
          className={cn(
            "overflow-hidden rounded-xl border border-border/50 bg-muted/15",
            "shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
          )}
        >
          {block}
        </div>
      </li>
    );
  }

  return <div className="min-w-0">{block}</div>;
}

export default function SeriesEpisodesSection({
  episodes,
  currentVideoUniqueId,
  currentUserId,
  userActions,
}: SeriesEpisodesSectionProps) {
  const [seriesOpen, setSeriesOpen] = useState(true);
  const [episodeOpen, setEpisodeOpen] = useState<Record<string, boolean>>(() =>
    buildEpisodeOpenInitial(episodes, currentVideoUniqueId)
  );

  const episodeKey = useMemo(
    () => collectEpisodeIds(episodes).join("|"),
    [episodes]
  );

  const totalVideos = useMemo(
    () => episodes.reduce((n, ep) => n + countEpisodeItems(ep), 0),
    [episodes]
  );

  useEffect(() => {
    setEpisodeOpen((prev) => {
      const next = { ...prev };
      markOpenForCurrent(episodes, currentVideoUniqueId, next);
      return next;
    });
  }, [currentVideoUniqueId, episodeKey, episodes]);

  if (!episodes.length) return null;

  return (
    <section
      className={cn(
        "mb-5 overflow-hidden rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm",
        "shadow-[0_1px_0_rgba(255,255,255,0.05)_inset,0_10px_28px_-14px_rgba(0,0,0,0.2)]"
      )}
      aria-label="Series"
    >
      <Collapsible open={seriesOpen} onOpenChange={setSeriesOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors",
              "hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              "data-[state=open]:border-b data-[state=open]:border-border/40"
            )}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
              <Layers className="h-4 w-4" strokeWidth={2} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold leading-snug text-foreground">
                Series
              </p>
              <p className="text-[12px] text-muted-foreground">
                {totalVideos} video{totalVideos === 1 ? "" : "s"}
              </p>
            </div>
            <ChevronRight
              className={cn(
                "h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-300 ease-out",
                seriesOpen && "rotate-90"
              )}
              strokeWidth={1.75}
              aria-hidden
            />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="max-h-[min(72vh,560px)] overflow-y-auto overscroll-contain px-3 pb-3 pt-0.5 [scrollbar-gutter:stable]">
            <ul className="m-0 list-none space-y-3 p-0">
              {episodes.map((ep) => (
                <EpisodeBlock
                  key={ep.episode_id}
                  ep={ep}
                  depth={0}
                  currentVideoUniqueId={currentVideoUniqueId}
                  currentUserId={currentUserId}
                  userActions={userActions}
                  episodeOpen={episodeOpen}
                  setEpisodeOpen={setEpisodeOpen}
                />
              ))}
            </ul>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
