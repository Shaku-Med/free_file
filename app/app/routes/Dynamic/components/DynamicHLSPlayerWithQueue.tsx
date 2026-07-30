import type { ComponentProps } from "react";
import HLSPlayer from "~/components/components/hlsplayer";
import { usePlayQueue } from "./PlayQueueContext";

/** Queue-injected props; guest preview cap is explicit because ComponentProps<typeof HLSPlayer> can omit optional fields in some TS setups. */
export type DynamicHLSPlayerWithQueueProps = Omit<
  ComponentProps<typeof HLSPlayer>,
  "suggestedVideos" | "seriesUpNextVideos"
> & {
  guestWatchLimitSeconds?: number | null;
};

/**
 * Renders HLSPlayer with up-next props from PlayQueueProvider (must be inside
 * provider).
 *
 * Up-next is series episodes when the file belongs to a series, otherwise the
 * similar videos the watch loader already prefetched. There is no user-facing
 * play queue and no client-side queue fetch.
 */
export function DynamicHLSPlayerWithQueue(props: DynamicHLSPlayerWithQueueProps) {
  const { effectiveSeriesUpNext, effectiveSuggested } = usePlayQueue();
  return (
    <HLSPlayer
      {...props}
      suggestedVideos={effectiveSuggested}
      seriesUpNextVideos={effectiveSeriesUpNext}
    />
  );
}
