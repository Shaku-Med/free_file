import { useSyncExternalStore, type ComponentProps } from "react";
import { useParams, useSearchParams } from "react-router";
import HLSPlayer from "~/components/components/hlsplayer";
import { usePlayQueue } from "./PlayQueueContext";
import { isMixGid } from "~/lib/music/mixId";
import { getMix, subscribeMix } from "~/lib/music/mixStore";
import type { FileType } from "~/lib/types";

/** Queue-injected props; guest preview cap is explicit because ComponentProps<typeof HLSPlayer> can omit optional fields in some TS setups. */
export type DynamicHLSPlayerWithQueueProps = Omit<
  ComponentProps<typeof HLSPlayer>,
  "suggestedVideos" | "seriesUpNextVideos"
> & {
  guestWatchLimitSeconds?: number | null;
};

/** Renders HLSPlayer with queue props from PlayQueueProvider (must be inside provider). */
export function DynamicHLSPlayerWithQueue(props: DynamicHLSPlayerWithQueueProps) {
  const { effectiveSeriesUpNext, effectiveSuggested } = usePlayQueue();
  const [searchParams] = useSearchParams();
  const params = useParams();

  const gid = searchParams.get("list") ?? "";
  const inMix = isMixGid(gid);
  const currentUniqueId = String(params.uniqueId ?? params.id ?? "");

  const mix = useSyncExternalStore(
    subscribeMix,
    () => (inMix ? getMix(gid) : undefined),
    () => undefined,
  );

  /**
   * When a mix is active it OWNS what plays next: up-next becomes the tracks
   * after the current one, in mix order. Without this the player fell back to
   * generic related videos and auto-advance wandered out of the list the
   * viewer had chosen.
   *
   * When there's no mix this passes through untouched, so series and normal
   * watch pages behave exactly as before.
   */
  let suggested: FileType[] = effectiveSuggested;
  if (inMix && mix && mix.items.length > 0) {
    const i = mix.items.findIndex(
      (f) => String(f.unique_id) === currentUniqueId,
    );
    const rest = i === -1 ? mix.items : mix.items.slice(i + 1);
    // Fall back to the whole mix when we're on the last track so the end card
    // can still offer something from the list rather than nothing.
    suggested = rest.length > 0 ? rest : mix.items.filter(
      (f) => String(f.unique_id) !== currentUniqueId,
    );
  }

  return (
    <HLSPlayer
      {...props}
      suggestedVideos={suggested}
      seriesUpNextVideos={effectiveSeriesUpNext}
    />
  );
}
