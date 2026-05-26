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
import { ChevronRight, Layers, Link2, ListVideo, Play } from "lucide-react";
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
import { AlertTriangle, EyeOff, ShieldQuestion } from "lucide-react";
import { useCallback } from "react";

/**
 * Pure helper that removes adult-flagged items the viewer is NOT the
 * owner of, recursively across nested episodes. Owners always keep
 * visibility into their own adult-flagged uploads so they can review /
 * request a re-classification.
 *
 * When ownerHideAdult is true, the owner ALSO hides their own adult
 * items (helps owners screen-share without exposing flagged uploads).
 */
function pruneAdultForViewer(
  eps: SeriesEpisodeGroup[],
  viewerUserId: string | undefined,
  ownerHideAdult: boolean,
): SeriesEpisodeGroup[] {
  return eps.map((ep) => ({
    ...ep,
    items: ep.items.filter((v) => {
      if (!v.is_adult) return true;
      const isOwner =
        typeof v.owner_id === "string" &&
        typeof viewerUserId === "string" &&
        v.owner_id === viewerUserId;
      // Non-owners never see adult items; owners see them unless they've
      // toggled the hide switch (screen-share / privacy mode).
      if (!isOwner) return false;
      return !ownerHideAdult;
    }),
    nested: ep.nested
      ? pruneAdultForViewer(ep.nested, viewerUserId, ownerHideAdult)
      : ep.nested,
  }));
}

/** True when the viewer owns at least one adult-flagged file in this series. */
function viewerOwnsAdultInSeries(
  eps: SeriesEpisodeGroup[],
  viewerUserId: string | undefined,
): boolean {
  if (!viewerUserId) return false;
  for (const ep of eps) {
    for (const v of ep.items) {
      if (v.is_adult && v.owner_id === viewerUserId) return true;
    }
    if (ep.nested && viewerOwnsAdultInSeries(ep.nested, viewerUserId)) {
      return true;
    }
  }
  return false;
}

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
    <div className={cn("relative mt-2", THREAD_PL)}>
      {/* Continuous vertical line */}
      <div
        className={cn(
          "pointer-events-none absolute bottom-0 top-0 w-[2px] rounded-full",
          SPINE_LEFT,
          "bg-muted-foreground/22 dark:bg-muted-foreground/30"
        )}
        aria-hidden
      />
      <ul className="m-0 list-none space-y-2 p-0">{children}</ul>
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
  onRequestAdultReview,
  reviewingFor,
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
  onRequestAdultReview?: (fileId: string) => void;
  reviewingFor?: string | null;
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
            "flex w-full items-center gap-2 border-b border-border/50 px-2 py-2 text-left transition-colors",
            "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset",
            "data-[state=open]:bg-muted/15",
            !isRoot && "px-1.5"
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
        <div className="space-y-1 pb-1 pt-0">
          <ul className="m-0 list-none space-y-0 px-0">
            {ep.items.map((video, index) => {
              const isCurrent = video.unique_id === currentVideoUniqueId;
              const isOwnerAdult =
                Boolean(video.is_adult) &&
                typeof currentUserId === "string" &&
                video.owner_id === currentUserId;
              return (
                <li
                  key={video.unique_id}
                  className={cn(
                    "flex min-w-0 list-none items-stretch gap-2 border-b border-border/40 py-1.5 pl-1 pr-0 last:border-b-0",
                    isCurrent &&
                      "rounded-lg bg-[#3d2c20]/35 ring-1 ring-[#6b4c2e]/45 dark:bg-white/[0.07] dark:ring-white/12",
                  )}
                >
                  <div className="flex w-7 shrink-0 items-start justify-center pt-2" aria-hidden>
                    {isCurrent ? (
                      <Play className="h-4 w-4 shrink-0 fill-primary text-primary" aria-hidden />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <VideoCard
                      layout={`compact`}
                      related
                      hideActions={{ completely: false, halfway: true }}
                      data={video}
                      index={index}
                      currentUserId={currentUserId}
                      userActions={userActions}
                      onAddToPlayQueue={onAddToPlayQueue}
                      inPlayQueue={inPlayQueue(video.id)}
                    />
                    {/* Owner-only "Adult flagged" badge + review request. Never
                        visible to anyone else because the file is filtered out
                        of `ep.items` for non-owners upstream. */}
                    {isOwnerAdult && onRequestAdultReview && (
                      <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[11px]">
                        <span className="inline-flex items-center gap-1 text-amber-300">
                          <AlertTriangle className="h-3 w-3" aria-hidden />
                          Flagged as adult
                        </span>
                        <button
                          type="button"
                          onClick={() => onRequestAdultReview(video.id)}
                          disabled={reviewingFor === video.id}
                          className="ml-auto inline-flex items-center gap-1 rounded border border-border/60 bg-background/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:opacity-60"
                          title="Ask us to review this classification"
                        >
                          <ShieldQuestion className="h-3 w-3" aria-hidden />
                          {reviewingFor === video.id ? "Sending…" : "Request review"}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="w-8 shrink-0" aria-hidden />
                </li>
              );
            })}
          </ul>
          {nestedCount > 0 && ep.nested && (
            <NestedEpisodeThread>
              {ep.nested.map((child) => (
                <NestedEpisodeRow key={child.episode_id}>
                  <div className="overflow-hidden rounded-lg border border-border/50 bg-muted/10">
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
                      onRequestAdultReview={onRequestAdultReview}
                      reviewingFor={reviewingFor}
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
      <li className="min-w-0 list-none overflow-hidden rounded-lg border border-border/60 bg-muted/10">
        {block}
      </li>
    );
  }

  return <div className="min-w-0">{block}</div>;
}

export default function SeriesEpisodesSection({
  episodes: rawEpisodes,
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

  // Owner-only toggle: hide my own adult-flagged items (e.g. when
  // screen-sharing). Default = show. Has no effect for non-owners,
  // who never see adult items in this list regardless.
  const [ownerHideAdult, setOwnerHideAdult] = useState(false);

  const ownerHasAdultFlagged = useMemo(
    () => viewerOwnsAdultInSeries(rawEpisodes, currentUserId),
    [rawEpisodes, currentUserId],
  );

  // Apply the viewer-side filter. Non-owners NEVER see is_adult items;
  // owners see theirs unless they toggle "hide". This is defense-in-depth
  // at the rendering layer — the server should already enforce access on
  // the file row itself.
  const episodes = useMemo(
    () => pruneAdultForViewer(rawEpisodes, currentUserId, ownerHideAdult),
    [rawEpisodes, currentUserId, ownerHideAdult],
  );

  // Request a moderation re-review for one of my adult-flagged files.
  // Posts to the existing /api/adult-review endpoint with action=submit.
  const [reviewingFor, setReviewingFor] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState<string | null>(null);
  const requestAdultReview = useCallback(async (fileId: string) => {
    setReviewingFor(fileId);
    setReviewStatus(null);
    try {
      const res = await fetch("/api/adult-review", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_id: fileId,
          action: "submit",
          reason: "Owner requested adult-classification review from series view.",
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { success?: boolean; error?: string }
        | null;
      if (res.ok && body?.success !== false) {
        setReviewStatus("Review requested. We'll get back to you.");
      } else {
        setReviewStatus(body?.error || "Could not submit review right now.");
      }
    } catch {
      setReviewStatus("Could not submit review right now.");
    } finally {
      setReviewingFor(null);
    }
  }, []);

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
    <section
      className="mb-4 min-w-0 overflow-hidden rounded-lg border border-border/60 bg-card/40 sm:mb-5"
      aria-label="Series"
    >
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
            className="h-auto shrink-0 rounded-none border-l border-border/50 px-2 text-muted-foreground hover:bg-muted/30 hover:text-foreground"
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
          {/* Owner-only adult-content toolbar: appears only when the
              viewer owns at least one adult-flagged file in this series.
              Non-owners never see this row (and never see the items at all). */}
          {ownerHasAdultFlagged && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border/50 bg-amber-500/5 px-3 py-2 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
              <span className="text-muted-foreground">
                Some of your items in this series are flagged as adult — only
                you can see them.
              </span>
              <button
                type="button"
                onClick={() => setOwnerHideAdult((v) => !v)}
                className={cn(
                  "ml-auto inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-medium transition-colors",
                  ownerHideAdult
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15"
                    : "border-border/60 bg-background/60 text-muted-foreground hover:text-foreground hover:bg-muted/40",
                )}
                aria-pressed={ownerHideAdult}
              >
                <EyeOff className="h-3.5 w-3.5" aria-hidden />
                {ownerHideAdult ? "Hidden in this view" : "Hide in this view"}
              </button>
              {reviewStatus && (
                <span className="basis-full text-[11px] text-muted-foreground">
                  {reviewStatus}
                </span>
              )}
            </div>
          )}

          {(resumeTarget || (playQueue?.viewerCanCustomizeQueue && seriesNext.length > 0)) && (
            <div className="space-y-2 border-b border-border/50 bg-muted/15 px-2 py-2">
              {resumeTarget ? (
                <Link
                  to={`/${resumeTarget.unique_id}`}
                  className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-border/60 bg-background px-2 py-2 text-left text-xs transition-colors hover:bg-accent/50 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
                >
                  <span className="font-semibold text-primary">Continue watching</span>
                  <span className="line-clamp-2 text-muted-foreground sm:text-right">
                    {resumeTarget.file_title?.trim() || resumeTarget.filename || "Open episode"}
                  </span>
                </Link>
              ) : null}
              {playQueue?.viewerCanCustomizeQueue && seriesNext.length > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-8 w-full gap-1.5 text-xs"
                  onClick={() => playQueue.replaceQueueWith(seriesNext)}
                >
                  <ListVideo className="h-3.5 w-3.5 shrink-0" />
                  Queue {seriesNext.length} more in series order
                </Button>
              ) : null}
            </div>
          )}
          <div className="max-h-[calc(100svh-9rem-env(safe-area-inset-bottom,0px))] min-h-0 overflow-y-auto overscroll-auto px-1 [scrollbar-gutter:stable] sm:max-h-[calc(100svh-8rem-env(safe-area-inset-bottom,0px))]">
            <ul className="m-0 list-none space-y-1">
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
                  onRequestAdultReview={requestAdultReview}
                  reviewingFor={reviewingFor}
                />
              ))}
            </ul>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
