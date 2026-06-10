import { useLayoutEffect } from "react";
import { useLocation } from "react-router";
import { isReelPath, isSingleSegmentWatchPath } from "~/lib/Context/MiniPlayerContext";
import { useMainPlayerSlot } from "~/lib/Context/MainPlayerSlotContext";
import { useWatchHlsSurface } from "~/lib/Context/WatchHlsSurfaceContext";

/** Routes that mount the in-page watch player slot (`player_inner_*`). */
export function isWatchPlayerHostPath(pathname: string): boolean {
  return isSingleSegmentWatchPath(pathname);
}

/**
 * Clears the watch HLS surface + main slot when navigating away from pages that
 * host the player anchor. Prevents the global portaled player from sticking at
 * its last fixed position (e.g. after opening Studio).
 */
export function SyncGlobalPlayerHost() {
  const location = useLocation();
  const { surface, setSurface } = useWatchHlsSurface();
  const { setSlot } = useMainPlayerSlot();

  useLayoutEffect(() => {
    const path = location.pathname;
    if (isWatchPlayerHostPath(path) || isReelPath(path)) return;
    if (surface?.props) setSurface(null);
    setSlot(null, null);
  }, [location.pathname, surface?.props, setSurface, setSlot]);

  return null;
}
