import { useMemo, type ReactNode } from "react";
import { useMiniPlayerContext } from "~/lib/Context/MiniPlayerContext";
import { useWatchPlayBootstrap } from "~/lib/Context/WatchPlayBootstrapContext";
import { PlayQueueProvider } from "~/routes/Dynamic/components/PlayQueueContext";
import type { FileType } from "~/lib/types";

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
  const { bootstrap, queueData, queueFetchKey, queueLoading, refreshQueue } =
    useWatchPlayBootstrap();
  const { miniPlayer } = useMiniPlayerContext();

  const effective = useMemo(() => {
    if (bootstrap) {
      return {
        currentUniqueId: bootstrap.currentUniqueId,
        seriesUpNextVideos: queueData?.seriesUpNextVideos ?? [],
        suggestedVideos: queueData?.suggestedVideos ?? [],
        viewerCanCustomizeQueue: bootstrap.viewerCanCustomizeQueue,
        queueFetchKey,
        queueLoading,
        refreshQueue,
      };
    }
    if (miniPlayer) {
      return {
        currentUniqueId: miniPlayer.imageID,
        seriesUpNextVideos: [] as const,
        suggestedVideos: [] as const,
        viewerCanCustomizeQueue: false,
        queueFetchKey: 0,
        queueLoading: false,
        refreshQueue,
      };
    }
    return {
      currentUniqueId: EMPTY_BOOTSTRAP.currentUniqueId,
      seriesUpNextVideos: [] as const,
      suggestedVideos: [] as const,
      viewerCanCustomizeQueue: false,
      queueFetchKey: 0,
      queueLoading: false,
      refreshQueue,
    };
  }, [bootstrap, queueData, miniPlayer, queueFetchKey, queueLoading, refreshQueue]);

  return (
    <PlayQueueProvider
      currentUniqueId={effective.currentUniqueId}
      seriesUpNextVideos={effective.seriesUpNextVideos as FileType[]}
      suggestedVideos={effective.suggestedVideos as FileType[]}
      viewerCanCustomizeQueue={effective.viewerCanCustomizeQueue}
      queueFetchKey={effective.queueFetchKey}
      queueLoading={effective.queueLoading}
      refreshQueue={effective.refreshQueue}
    >
      {children}
    </PlayQueueProvider>
  );
}
