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

/** Renders HLSPlayer with queue props from PlayQueueProvider (must be inside provider). */
export function DynamicHLSPlayerWithQueue(props: DynamicHLSPlayerWithQueueProps) {
  const { effectiveSeriesUpNext, effectiveSuggested } = usePlayQueue();
  return (
    <HLSPlayer
      {...props}
      suggestedVideos={effectiveSuggested}
      seriesUpNextVideos={effectiveSeriesUpNext}
      loop={true}
    />
  );
}
