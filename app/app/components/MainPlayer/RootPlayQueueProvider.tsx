import { useMemo, type ReactNode } from "react";
import { useMiniPlayerContext } from "~/lib/Context/MiniPlayerContext";
import { useWatchPlayBootstrap } from "~/lib/Context/WatchPlayBootstrapContext";
import { PlayQueueProvider } from "~/routes/Dynamic/components/PlayQueueContext";

const EMPTY_BOOTSTRAP = {
  currentUniqueId: "__none__",
  seriesUpNextVideos: [] as const,
  suggestedVideos: [] as const,
  viewerCanCustomizeQueue: false,
} as const;

/**
 * Hoisted queue so `DynamicHLSPlayerWithQueue` can stay mounted when navigating away
 * into floating mini player (bootstrap falls back to the mini `currentUniqueId`).
 */
export function RootPlayQueueProvider({ children }: { children: ReactNode }) {
  const { bootstrap } = useWatchPlayBootstrap();
  const { miniPlayer } = useMiniPlayerContext();

  const effective = useMemo(() => {
    if (bootstrap) return bootstrap;
    if (miniPlayer) {
      return {
        currentUniqueId: miniPlayer.imageID,
        seriesUpNextVideos: [],
        suggestedVideos: [],
        viewerCanCustomizeQueue: false,
      };
    }
    return {
      currentUniqueId: EMPTY_BOOTSTRAP.currentUniqueId,
      seriesUpNextVideos: [],
      suggestedVideos: [],
      viewerCanCustomizeQueue: false,
    };
  }, [bootstrap, miniPlayer]);

  return (
    <PlayQueueProvider
      currentUniqueId={effective.currentUniqueId}
      seriesUpNextVideos={effective.seriesUpNextVideos}
      suggestedVideos={effective.suggestedVideos}
      viewerCanCustomizeQueue={effective.viewerCanCustomizeQueue}
    >
      {children}
    </PlayQueueProvider>
  );
}
