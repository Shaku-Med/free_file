import { useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import {
  isReelPath,
  isSingleSegmentWatchPath,
  useMiniPlayerContext,
} from '~/lib/Context/MiniPlayerContext';

/**
 * When mini was open and the user visited `/reel*`, playback state is suspended.
 * Leaving reel to a non-watch page restores the mini player; going straight to
 * `/:id` watch clears the snapshot so the full player can take over.
 */
export function RestoreMiniPlayerAfterReel() {
  const location = useLocation();
  const prevPathnameRef = useRef(location.pathname);
  const {
    resumeSuspendedMiniPlayer,
    clearSuspendedMiniForReel,
  } = useMiniPlayerContext();

  useLayoutEffect(() => {
    const prev = prevPathnameRef.current;
    const next = location.pathname;
    prevPathnameRef.current = next;

    if (prev === next) return;
    if (!isReelPath(prev) || isReelPath(next)) return;

    if (isSingleSegmentWatchPath(next)) {
      clearSuspendedMiniForReel();
      return;
    }

    resumeSuspendedMiniPlayer();
  }, [location.pathname, resumeSuspendedMiniPlayer, clearSuspendedMiniForReel]);

  return null;
}
