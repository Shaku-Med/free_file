import { useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import {
  getDynamicVideoIdFromPath,
  isDynamicVideoPath,
  useMiniPlayerContext,
} from '~/lib/Context/MiniPlayerContext';

/**
 * When the user navigates to a different dynamic (video) page while the mini player
 * is open, close the mini shell so the in-page player can take over.
 *
 * If the navigation target is the same video as the mini player, the watch page
 * dismisses the mini chrome after the main slot is mounted (seamless handoff).
 */
export function CloseMiniPlayerOnNavigateToVideo() {
  const {
    miniPlayer,
    closeMiniPlayer,
    clearSuspendedMiniForReel,
    isExpanding,
  } = useMiniPlayerContext();
  const location = useLocation();
  const prevPathnameRef = useRef(location.pathname);

  useLayoutEffect(() => {
    const prev = prevPathnameRef.current;
    const next = location.pathname;
    prevPathnameRef.current = next;

    if (prev === next) return;

    if (isDynamicVideoPath(next)) {
      clearSuspendedMiniForReel();
      if (!miniPlayer) return;
      const nextVideoId = getDynamicVideoIdFromPath(next);
      // Same URL id + expanding from mini → watch page will dismiss chrome after slot mounts.
      if (nextVideoId && miniPlayer.file.unique_id === nextVideoId && isExpanding) return;
      if (isExpanding) return;
      closeMiniPlayer();
    }
  }, [location.pathname, miniPlayer, closeMiniPlayer, clearSuspendedMiniForReel, isExpanding]);

  return null;
}
