import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { FileType, SeriesEpisodeGroup } from "~/lib/types";
import { Link } from "react-router";
import VideoCard from "~/routes/Home/components/VideoCard";
import { Button } from "~/components/ui/button";
import { ChevronRight, Layers, Link2, ListVideo } from "lucide-react";
import { cn } from "~/lib/utils";
import { usePlayQueueOptional } from "./PlayQueueContext";
import {
  flattenSeriesEpisodesInOrder,
  getSeriesUpNextVideos,
} from "../fun/mapSeriesRpcRows";
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
  /** For “continue watching” / last episode in this series (device localStorage). */
  fileSeriesId?: string | null;
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
  onAddToPlayQueue,
  inPlayQueue,
}: {
  ep: SeriesEpisodeGroup;
  depth: number;
  currentVideoUniqueId: string;
  currentUserId?: string;
  userActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
  episodeOpen: Record<string, boolean>;
  setEpisodeOpen: Dispatch<SetStateAction<Record<string, boolean>>>;
  onAddToPlayQueue?: (video: FileType) => void;
  inPlayQueue: (fileId: string) => boolean;
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
            "flex w-full items-center gap-2 border-b border-border/50 px-3 py-2 text-left transition-colors",
            "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset",
            "data-[state=open]:bg-muted/25",
            !isRoot && "px-2"
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
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold leading-snug text-foreground">
              {label}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {[part, `${totalVideos} video${totalVideos === 1 ? "" : "s"}`]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 pb-2 pt-0">
          <ul className="m-0 list-none px-1">
            {ep.items.map((video, index) => {
              const isCurrent = video.unique_id === currentVideoUniqueId;
              return (
                <li
                  key={video.unique_id}
                  className={cn(
                    "flex items-stretch gap-2 border-b border-border/50 py-1 pl-1 pr-0 last:border-b-0",
                    isCurrent && "rounded-md bg-primary/[0.07] ring-1 ring-primary/18"
                  )}
                >
                  {/* Align with play queue rows: spacer column matches grip width */}
                  <div className="flex w-7 shrink-0 items-start justify-center pt-2" aria-hidden>
                    {isCurrent ? (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary shadow-sm ring-2 ring-primary/25" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <VideoCard
                      layout="horizontal"
                      related
                      data={video}
                      index={index}
                      currentUserId={currentUserId}
                      userActions={userActions}
                      onAddToPlayQueue={onAddToPlayQueue}
                      inPlayQueue={inPlayQueue(video.id)}
                    />
                  </div>
                  {/* Balance queue remove-button column */}
                  <div className="w-8 shrink-0" aria-hidden />
                </li>
              );
            })}
          </ul>
          {nestedCount > 0 && ep.nested && (
            <NestedEpisodeThread>
              {ep.nested.map((child) => (
                <NestedEpisodeRow key={child.episode_id}>
                  <div className="overflow-hidden rounded-lg border border-border/50 bg-muted/15">
                    <EpisodeBlock
                      ep={child}
                      depth={depth + 1}
                      currentVideoUniqueId={currentVideoUniqueId}
                      currentUserId={currentUserId}
                      userActions={userActions}
                      episodeOpen={episodeOpen}
                      setEpisodeOpen={setEpisodeOpen}
                      onAddToPlayQueue={onAddToPlayQueue}
                      inPlayQueue={inPlayQueue}
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
      <li className="min-w-0 list-none overflow-hidden rounded-lg border border-border/50 bg-card/30">
        {block}
      </li>
    );
  }

  return <div className="min-w-0">{block}</div>;
}

export default function SeriesEpisodesSection({
  episodes,
  currentVideoUniqueId,
  fileSeriesId,
  currentUserId,
  userActions,
}: SeriesEpisodesSectionProps) {
  const playQueue = usePlayQueueOptional();
  const onAddToPlayQueue = playQueue?.viewerCanCustomizeQueue
    ? (video: FileType) => playQueue.addToQueue(video)
    : undefined;
  const inPlayQueue = (fileId: string) => playQueue?.isInQueue(fileId) ?? false;

  const seriesNext = useMemo(
    () => getSeriesUpNextVideos(episodes, currentVideoUniqueId),
    [episodes, currentVideoUniqueId]
  );

  const resumeTarget = useMemo(() => {
    if (!fileSeriesId || typeof localStorage === "undefined") return null;
    try {
      const raw = localStorage.getItem(`seriesLastWatch:${fileSeriesId}`);
      if (!raw || raw === currentVideoUniqueId) return null;
      const flat = flattenSeriesEpisodesInOrder(episodes);
      return flat.find((v) => v.unique_id === raw) ?? null;
    } catch {
      return null;
    }
  }, [fileSeriesId, currentVideoUniqueId, episodes]);

  const [seriesOpen, setSeriesOpen] = useState(true);
  const [episodeOpen, setEpisodeOpen] = useState<Record<string, boolean>>(() =>
    buildEpisodeOpenInitial(episodes, currentVideoUniqueId)
  );
  const [episodeLinkCopied, setEpisodeLinkCopied] = useState(false);

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

  const episodeUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/${currentVideoUniqueId}`
      : `/${currentVideoUniqueId}`;

  const copyEpisodeLink = async () => {
    try {
      await navigator.clipboard.writeText(episodeUrl);
      setEpisodeLinkCopied(true);
      window.setTimeout(() => setEpisodeLinkCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <section className="mb-4 min-w-0 rounded-lg border border-border/60 bg-card/40 sm:mb-5" aria-label="Series">
      <Collapsible open={seriesOpen} onOpenChange={setSeriesOpen}>
        <div className="flex min-w-0 items-stretch border-b border-border/50">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2 text-left transition-colors",
                "hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-inset",
                "data-[state=open]:bg-muted/15"
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <Layers className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
                <span className="truncate text-sm font-semibold text-foreground">Series</span>
                <span className="text-xs text-muted-foreground tabular-nums">({totalVideos})</span>
              </div>
              <ChevronRight
                className={cn(
                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out",
                  seriesOpen && "rotate-90"
                )}
                strokeWidth={2}
                aria-hidden
              />
            </button>
          </CollapsibleTrigger>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-auto shrink-0 rounded-none border-l border-border/50 px-3 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.preventDefault();
              void copyEpisodeLink();
            }}
            aria-label="Copy link to this episode"
            title={episodeLinkCopied ? "Copied" : "Copy episode link"}
          >
            <Link2 className="h-4 w-4" strokeWidth={2} aria-hidden />
          </Button>
        </div>

        <CollapsibleContent>
          {(resumeTarget || (playQueue?.viewerCanCustomizeQueue && seriesNext.length > 0)) && (
            <div className="space-y-2 border-b border-border/50 bg-muted/15 px-2 py-2">
              {resumeTarget ? (
                <Link
                  to={`/${resumeTarget.unique_id}`}
                  className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-border/60 bg-background px-2.5 py-2 text-left text-xs transition-colors hover:bg-accent/50 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
                >
                  <span className="font-semibold text-primary">Continue watching</span>
                  <span className="truncate text-muted-foreground">
                    {resumeTarget.file_title?.trim() || resumeTarget.filename || "Open episode"}
                  </span>
                </Link>
              ) : null}
              {playQueue?.viewerCanCustomizeQueue && seriesNext.length > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-9 w-full gap-1.5 text-xs"
                  onClick={() => playQueue.replaceQueueWith(seriesNext)}
                >
                  <ListVideo className="h-3.5 w-3.5 shrink-0" />
                  Queue {seriesNext.length} more in series order
                </Button>
              ) : null}
            </div>
          )}
          <div className="flex max-h-[min(36dvh,240px)] flex-col overflow-hidden sm:max-h-[min(40vh,280px)]">
            <ul className="m-0 list-none space-y-2 overflow-y-auto overscroll-contain px-1 py-2 [scrollbar-gutter:stable]">
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
                  onAddToPlayQueue={onAddToPlayQueue}
                  inPlayQueue={inPlayQueue}
                />
              ))}
            </ul>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
