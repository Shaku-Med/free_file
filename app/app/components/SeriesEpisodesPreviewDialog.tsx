import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { ExternalLink } from "lucide-react";
import { Link } from "react-router";
import type { SeriesEpisodeGroup } from "~/lib/types";
import SeriesEpisodesSection from "~/routes/Dynamic/components/SeriesEpisodesSection";
import SeriesSignInGate from "~/routes/Dynamic/components/SeriesSignInGate";

export type SeriesEpisodesPreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Series main or any file in the series — `/api/dynamic-series` resolves by unique_id */
  uniqueId: string | null;
  seriesTitle?: string | null;
  fileSeriesId?: string | null;
  currentUserId?: string;
  userActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
};

export function SeriesEpisodesPreviewDialog({
  open,
  onOpenChange,
  uniqueId,
  seriesTitle,
  fileSeriesId,
  currentUserId,
  userActions,
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
        </div>

        <div className="shrink-0 border-t border-border px-4 py-3 sm:px-6">
          <Button asChild variant="default" className="w-full rounded-full">
            <Link to={watchHref} onClick={() => onOpenChange(false)}>
              <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
              Open series page
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
