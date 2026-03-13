import { useState, useEffect, useCallback, useRef } from 'react';

interface RemotePlaybackAPI {
  watchAvailability: (cb: (available: boolean) => void) => Promise<number>;
  cancelWatchAvailability?: (id: number) => Promise<void>;
  prompt: () => Promise<void>;
}

/**
 * Hook for Remote Playback API (Cast/AirPlay).
 * Returns whether cast devices are available and a function to prompt the user to pick one.
 */
export function useRemotePlayback(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [isAvailable, setIsAvailable] = useState(false);
  const watchIdRef = useRef<number | null>(null);

  const prompt = useCallback(async () => {
    const video = videoRef.current;
    const remote = (video as HTMLVideoElement & { remote?: RemotePlaybackAPI })?.remote;
    if (!remote?.prompt) return;
    try {
      await remote.prompt();
    } catch {
      // User cancelled or API not fully supported
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const remote = (video as HTMLVideoElement & { remote?: RemotePlaybackAPI }).remote;
    if (!remote?.watchAvailability) {
      // Fallback: show button so user can try prompt() anyway (e.g. Chrome Cast extension)
      setIsAvailable(true);
      return;
    }

    let cancelled = false;
    remote
      .watchAvailability((available: boolean) => {
        if (!cancelled) setIsAvailable(available);
      })
      .then((id: number) => {
        if (!cancelled) watchIdRef.current = id;
      })
      .catch(() => {
        if (!cancelled) setIsAvailable(true); // Show button to let user try
      });

    return () => {
      cancelled = true;
      const id = watchIdRef.current;
      if (id != null && remote.cancelWatchAvailability) {
        remote.cancelWatchAvailability(id);
        watchIdRef.current = null;
      }
    };
  }, []);

  return { isAvailable, prompt };
}
