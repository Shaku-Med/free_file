import { useEffect } from "react";
import { useWatchPlayBootstrap } from "~/lib/Context/WatchPlayBootstrapContext";

/** Registers Dynamic-route watch identity for the root-hoisted play queue fetch. */
export function WatchPlayBootstrapSync({
  currentUniqueId,
  fileId,
  viewerCanCustomizeQueue,
  currentIsImage,
}: {
  currentUniqueId: string;
  fileId?: string;
  viewerCanCustomizeQueue: boolean;
  currentIsImage?: boolean;
}) {
  const { setBootstrap } = useWatchPlayBootstrap();
  useEffect(() => {
    setBootstrap({
      currentUniqueId,
      fileId,
      viewerCanCustomizeQueue,
      currentIsImage,
    });
    return () => setBootstrap(null);
  }, [currentUniqueId, fileId, viewerCanCustomizeQueue, currentIsImage, setBootstrap]);
  return null;
}
