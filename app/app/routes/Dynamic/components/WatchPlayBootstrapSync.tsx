import { useEffect } from "react";
import { useWatchPlayBootstrap } from "~/lib/Context/WatchPlayBootstrapContext";
import type { FileType } from "~/lib/types";

/**
 * Publishes the Dynamic route's watch identity AND its up-next content to the
 * root-hoisted player.
 *
 * Up-next is pushed from here because the watch loader already has it — the old
 * /api/play-queue round trip is gone.
 */
export function WatchPlayBootstrapSync({
  currentUniqueId,
  fileId,
  viewerCanCustomizeQueue,
  currentIsImage,
  seriesUpNextVideos,
  suggestedVideos,
  userActions,
}: {
  currentUniqueId: string;
  fileId?: string;
  viewerCanCustomizeQueue: boolean;
  currentIsImage?: boolean;
  seriesUpNextVideos?: FileType[];
  suggestedVideos?: FileType[];
  userActions?: { likedFileIds: string[]; dislikedFileIds: string[] };
}) {
  const { setBootstrap } = useWatchPlayBootstrap();
  useEffect(() => {
    setBootstrap({
      currentUniqueId,
      fileId,
      viewerCanCustomizeQueue,
      currentIsImage,
      seriesUpNextVideos,
      suggestedVideos,
      userActions,
    });
    return () => setBootstrap(null);
  }, [
    currentUniqueId,
    fileId,
    viewerCanCustomizeQueue,
    currentIsImage,
    seriesUpNextVideos,
    suggestedVideos,
    userActions,
    setBootstrap,
  ]);
  return null;
}
