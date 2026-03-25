import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { useMiniPlayerContext } from '~/lib/Context/MiniPlayerContext';

const STATIC_TOP_SEGMENTS = new Set([
  'privacy', 'terms', 'api', 'playlist', 'tag', 'search', 'features', 'auth',
  'logout', 'settings', 'notifications', 'profile', 'reel',
]);

function isDynamicVideoPath(pathname: string): boolean {
  const segment = pathname.replace(/^\//, '').split('/')[0] ?? '';
  if (!segment) return false;
  return !STATIC_TOP_SEGMENTS.has(segment);
}

/**
 * When the user navigates to a dynamic (video) page, close the mini player
 * so the full-page player can show. Does not close when already on that page
 * (e.g. when mini player was opened in portal mode from the same page).
 */
export function CloseMiniPlayerOnNavigateToVideo() {
  const { miniPlayer, closeMiniPlayer, isExpanding } = useMiniPlayerContext();
  const location = useLocation();
  const prevPathnameRef = useRef(location.pathname);

  useEffect(() => {
    const prev = prevPathnameRef.current;
    const next = location.pathname;
    prevPathnameRef.current = next;

    if (prev === next) return;
    if (!miniPlayer) return;
    // Don't auto-close if we're expanding — the main player will signal when ready
    if (isExpanding) return;
    if (isDynamicVideoPath(next)) {
      closeMiniPlayer();
    }
  }, [location.pathname, miniPlayer, closeMiniPlayer, isExpanding]);

  return null;
}
