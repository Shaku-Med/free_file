import { useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import {
  isDynamicVideoPath,
  useMiniPlayerContext,
} from '~/lib/Context/MiniPlayerContext';

/**
 * Housekeeping on navigation into a watch path: clear any reel-suspended mini
 * state. The actual "close the mini?" decision does NOT happen here anymore -
 * the URL alone can't tell an image post from a video, and closing on the path
 * killed the mini for images. The watch page decides after its loader runs
 * (see the mini player effect in routes/Dynamic/index.tsx): images keep the
 * mini playing, videos close it so the in-page player takes over.
 */
export function CloseMiniPlayerOnNavigateToVideo() {
  const { clearSuspendedMiniForReel } = useMiniPlayerContext();
  const location = useLocation();
  const prevPathnameRef = useRef(location.pathname);

  useLayoutEffect(() => {
    const prev = prevPathnameRef.current;
    const next = location.pathname;
    prevPathnameRef.current = next;

    if (prev === next) return;
    if (isDynamicVideoPath(next)) {
      clearSuspendedMiniForReel();
    }
  }, [location.pathname, clearSuspendedMiniForReel]);

  return null;
}
