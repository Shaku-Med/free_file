import { useEffect } from "react";
import type { FileType } from "~/lib/types";
import { useWatchPlayBootstrap } from "~/lib/Context/WatchPlayBootstrapContext";

/** Registers Dynamic-route queue inputs for the root-hoisted `PlayQueueProvider`. */
export function WatchPlayBootstrapSync({
  currentUniqueId,
  seriesUpNextVideos,
  suggestedVideos,
  viewerCanCustomizeQueue,
}: {
  currentUniqueId: string;
  seriesUpNextVideos: FileType[];
  suggestedVideos: FileType[];
  viewerCanCustomizeQueue: boolean;
}) {
  const { setBootstrap } = useWatchPlayBootstrap();
  useEffect(() => {
    setBootstrap({
      currentUniqueId,
      seriesUpNextVideos,
      suggestedVideos,
      viewerCanCustomizeQueue,
    });
    return () => setBootstrap(null);
  }, [
    currentUniqueId,
    seriesUpNextVideos,
    suggestedVideos,
    viewerCanCustomizeQueue,
    setBootstrap,
  ]);
  return null;
}
