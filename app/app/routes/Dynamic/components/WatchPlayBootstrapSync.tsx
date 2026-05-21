import { useEffect } from "react";
import { useWatchPlayBootstrap } from "~/lib/Context/WatchPlayBootstrapContext";

/** Registers Dynamic-route watch identity for the root-hoisted play queue fetch. */
export function WatchPlayBootstrapSync({
  currentUniqueId,
  fileId,
  viewerCanCustomizeQueue,
}: {
  currentUniqueId: string;
  fileId?: string;
  viewerCanCustomizeQueue: boolean;
}) {
  const { setBootstrap } = useWatchPlayBootstrap();
  useEffect(() => {
    setBootstrap({
      currentUniqueId,
      fileId,
      viewerCanCustomizeQueue,
    });
    return () => setBootstrap(null);
  }, [currentUniqueId, fileId, viewerCanCustomizeQueue, setBootstrap]);
  return null;
}
