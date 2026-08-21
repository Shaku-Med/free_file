import { useEffect, useState } from 'react';
import { AlertTriangle, RotateCcw } from '~/components/icons';

// Only paint after the error has been around for a grace period AND the page is
// visible. Most "failures" on mobile come from the page coming back to focus
// past the playback token TTL  useHLS re-mints, the hot swap lands in well
// under 2s, and the user never sees this UI. Pure recoverable jitter never
// reaches them. Genuine, unrecoverable errors still surface after the grace.
const GRACE_MS = 2000;

export default function ErrorOverlay({ onRetry }: { onRetry?: () => void }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let timer: number | null = null;

    const arm = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      timer = window.setTimeout(() => setShow(true), GRACE_MS);
    };

    const disarm = () => {
      setShow(false);
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    arm();

    const onVis = () => {
      disarm();
      arm();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      if (timer != null) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  if (!show) return null;

  return (
    // z-[60]: above the (hidden) control overlay so the Retry button is the only
    // thing the user can tap when playback has failed.
    <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black">
      <div className="flex flex-col items-center gap-3 text-center">
        <AlertTriangle className="h-10 w-10 text-white/50" />
        <p className="text-sm text-white/70">Failed to load video</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-medium text-white ring-1 ring-white/20 backdrop-blur-md transition-colors hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <RotateCcw className="h-4 w-4" />
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
