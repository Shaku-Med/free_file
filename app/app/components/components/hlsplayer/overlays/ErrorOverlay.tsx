import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

// Only paint after the error has been around for a grace period AND the page is
// visible. Most "failures" on mobile come from the page coming back to focus
// past the playback token TTL  useHLS re-mints, the hot swap lands in well
// under 2s, and the user never sees this UI. Pure recoverable jitter never
// reaches them. Genuine, unrecoverable errors still surface after the grace.
const GRACE_MS = 2000;

export default function ErrorOverlay() {
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
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black">
      <div className="text-center">
        <AlertTriangle className="w-10 h-10 text-white/50 mx-auto mb-2" />
        <p className="text-white/70 text-sm">Failed to load video</p>
      </div>
    </div>
  );
}
