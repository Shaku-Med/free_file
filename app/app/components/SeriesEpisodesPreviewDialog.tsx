import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { ArrowDown, ArrowUp, ExternalLink, ListOrdered, Loader2 } from "lucide-react";
import { Link } from "react-router";
import type { SeriesEpisodeGroup } from "~/lib/types";
import SeriesEpisodesSection from "~/routes/Dynamic/components/SeriesEpisodesSection";
import SeriesSignInGate from "~/routes/Dynamic/components/SeriesSignInGate";

export type SeriesEpisodesPreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Series main or any file in the series  `/api/dynamic-series` resolves by unique_id */
  uniqueId: string | null;
  seriesTitle?: string | null;
  fileSeriesId?: string | null;
  currentUserId?: string;
  userActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
  /** Series owner only: unlocks the "Reorder episodes" controls. */
  isOwner?: boolean;
};

type ReorderEpisode = { id: string; episode_name: string };

export function SeriesEpisodesPreviewDialog({
  open,
  onOpenChange,
  uniqueId,
  seriesTitle,
  fileSeriesId,
  currentUserId,
  userActions,
  isOwner = false,
}: SeriesEpisodesPreviewDialogProps) {
  const userActionsRef = useRef(userActions);
  useEffect(() => {
    userActionsRef.current = userActions;
  }, [userActions]);

  const [loadState, setLoadState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [episodes, setEpisodes] = useState<SeriesEpisodeGroup[] | null>(null);
  const [localActions, setLocalActions] = useState<{
    likedFileIds: Set<string>;
    dislikedFileIds: Set<string>;
  }>({ likedFileIds: new Set(), dislikedFileIds: new Set() });

  const signedIn = typeof currentUserId === "string" && currentUserId.trim().length > 0;

  // Owner-only "reorder episodes" mode. Loads the FLAT top-level episode list
  // from /api/series-episodes, lets the owner move items up/down, then persists
  // the new order via /api/file-series (action:"reorder").
  const canReorder = isOwner && signedIn && Boolean(fileSeriesId);
  const [reorderMode, setReorderMode] = useState(false);
  const [reorderEps, setReorderEps] = useState<ReorderEpisode[]>([]);
  const [reorderStatus, setReorderStatus] = useState<"idle" | "loading" | "saving" | "error">("idle");

  useEffect(() => {
    // Reset whenever the dialog closes so it reopens clean.
    if (!open) {
      setReorderMode(false);
      setReorderEps([]);
      setReorderStatus("idle");
    }
  }, [open]);

  const openReorder = () => {
    if (!fileSeriesId) return;
    setReorderMode(true);
    setReorderStatus("loading");
    fetch(`/api/series-episodes?file_series_id=${encodeURIComponent(fileSeriesId)}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { episodes?: Array<{ id: string; episode_name: string; parent_episode_id: string | null }> } | null) => {
        const flat = (j?.episodes ?? [])
          .filter((e) => !e.parent_episode_id)
          .map((e) => ({ id: String(e.id), episode_name: e.episode_name || "Untitled" }));
        setReorderEps(flat);
        setReorderStatus("idle");
      })
      .catch(() => setReorderStatus("error"));
  };

  const moveEpisode = (index: number, dir: -1 | 1) => {
    setReorderEps((prev) => {
      const to = index + dir;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  };

  const saveOrder = () => {
    if (!fileSeriesId || reorderEps.length === 0) return;
    setReorderStatus("saving");
    fetch("/api/file-series", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reorder",
        fileSeriesId,
        episodeIds: reorderEps.map((e) => e.id),
      }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("save failed"))))
      .then(() => {
        setReorderMode(false);
        // Re-pull the viewer tree so the dialog reflects the new order.
        setLoadState("idle");
        if (uniqueId && signedIn) {
          setLoadState("loading");
          fetch(`/api/dynamic-series?unique_id=${encodeURIComponent(uniqueId)}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((j: { seriesEpisodes?: SeriesEpisodeGroup[] | null } | null) => {
              setEpisodes(Array.isArray(j?.seriesEpisodes) ? j!.seriesEpisodes! : null);
              setLoadState("done");
            })
            .catch(() => setLoadState("error"));
        }
      })
      .catch(() => setReorderStatus("error"));
  };

  useEffect(() => {
    if (!open || !uniqueId) {
      setLoadState("idle");
      setEpisodes(null);
      return;
    }
    if (!signedIn) {
      setLoadState("done");
      setEpisodes(null);
      return;
    }

    const ac = new AbortController();
    setLoadState("loading");
    setEpisodes(null);

    fetch(`/api/dynamic-series?unique_id=${encodeURIComponent(uniqueId)}`, {
      credentials: "include",
      signal: ac.signal,
    })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as {
          seriesEpisodes?: SeriesEpisodeGroup[] | null;
          seriesVideosUserActions?: { likedFileIds: string[]; dislikedFileIds: string[] };
        };
        if (ac.signal.aborted) return;
        if (r.status === 401 || r.status === 403) {
          setLoadState("error");
          setEpisodes(null);
          return;
        }
        if (!r.ok) {
          setLoadState("error");
          return;
        }
        const liked = new Set(userActionsRef.current?.likedFileIds ?? []);
        const disliked = new Set(userActionsRef.current?.dislikedFileIds ?? []);
        j.seriesVideosUserActions?.likedFileIds?.forEach((id) => liked.add(id));
        j.seriesVideosUserActions?.dislikedFileIds?.forEach((id) => disliked.add(id));
        setLocalActions({ likedFileIds: liked, dislikedFileIds: disliked });
        setEpisodes(Array.isArray(j.seriesEpisodes) ? j.seriesEpisodes : null);
        setLoadState("done");
      })
      .catch(() => {
        if (!ac.signal.aborted) setLoadState("error");
      });

    return () => ac.abort();
  }, [open, uniqueId, signedIn]);

  const watchHref = uniqueId ? `/${encodeURIComponent(uniqueId)}` : "/";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[min(90vh,640px)] flex flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3 text-left sm:px-6">
          <DialogTitle className="text-base leading-snug">
            {seriesTitle?.trim() ? seriesTitle.trim() : "Series"}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3 sm:px-4">
          {reorderMode ? (
            <div className="px-1">
              <p className="px-1 pb-2 text-xs text-muted-foreground">
                Use the arrows to set the play order, then save.
              </p>
              {reorderStatus === "loading" ? (
                <div className="h-40 animate-pulse rounded-lg border border-border/60 bg-muted/25" aria-busy />
              ) : reorderStatus === "error" ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                  Could not load episodes. Try again.
                </p>
              ) : reorderEps.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                  No reorderable episodes.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {reorderEps.map((ep, i) => (
                    <li
                      key={ep.id}
                      className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-2"
                    >
                      <span className="w-6 shrink-0 text-center text-xs font-semibold tabular-nums text-muted-foreground">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {ep.episode_name}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveEpisode(i, -1)}
                          disabled={i === 0 || reorderStatus === "saving"}
                          aria-label="Move up"
                          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveEpisode(i, 1)}
                          disabled={i === reorderEps.length - 1 || reorderStatus === "saving"}
                          aria-label="Move down"
                          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <>
          {!signedIn && (
            <div className="px-1 pb-1">
              <SeriesSignInGate />
            </div>
          )}
          {signedIn && loadState === "loading" && (
            <div
              className="h-40 animate-pulse rounded-lg border border-border/60 bg-muted/25"
              aria-busy
              aria-label="Loading series episodes"
            />
          )}
          {signedIn && loadState === "error" && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              Could not load episodes. Try opening the series page.
            </p>
          )}
          {signedIn && loadState === "done" && episodes && episodes.length > 0 && uniqueId ? (
            <SeriesEpisodesSection
              episodes={episodes}
              currentVideoUniqueId={uniqueId}
              fileSeriesId={fileSeriesId ?? null}
              currentUserId={currentUserId}
              userActions={localActions}
            />
          ) : null}
          {signedIn &&
          loadState === "done" &&
          (!episodes || episodes.length === 0) ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No episodes in this series yet.
            </p>
          ) : null}
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-border px-4 py-3 sm:px-6">
          {reorderMode ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="flex-1 rounded-full"
                disabled={reorderStatus === "saving"}
                onClick={() => setReorderMode(false)}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                className="flex-1 rounded-full"
                disabled={reorderStatus === "saving" || reorderStatus === "loading" || reorderEps.length === 0}
                onClick={saveOrder}
              >
                {reorderStatus === "saving" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                ) : null}
                Save order
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {canReorder ? (
                <Button
                  variant="outline"
                  className="shrink-0 rounded-full"
                  onClick={openReorder}
                  aria-label="Reorder episodes"
                >
                  <ListOrdered className="mr-2 h-4 w-4" aria-hidden />
                  Reorder
                </Button>
              ) : null}
              <Button asChild variant="default" className="flex-1 rounded-full">
                <Link to={watchHref} onClick={() => onOpenChange(false)}>
                  <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
                  Open series page
                </Link>
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
