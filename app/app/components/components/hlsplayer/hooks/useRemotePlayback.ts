import { useState, useEffect, useCallback, useRef } from 'react';

interface RemotePlaybackAPI {
  watchAvailability: (cb: (available: boolean) => void) => Promise<number>;
  cancelWatchAvailability?: (id: number) => Promise<void>;
  prompt: () => Promise<void>;
  addEventListener?: (event: string, cb: () => void) => void;
  removeEventListener?: (event: string, cb: () => void) => void;
}

interface WebKitVideoElement extends HTMLVideoElement {
  webkitShowPlaybackTargetPicker?: () => void;
  webkitCurrentPlaybackTargetIsWireless?: boolean;
}

export function useRemotePlayback(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isCasting, setIsCasting] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  const isAirPlayRef = useRef(false);

  const prompt = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    const webkitVideo = video as WebKitVideoElement;
    if (isAirPlayRef.current && webkitVideo.webkitShowPlaybackTargetPicker) {
      webkitVideo.webkitShowPlaybackTargetPicker();
      return;
    }

    const remote = (video as HTMLVideoElement & { remote?: RemotePlaybackAPI })?.remote;
    if (!remote?.prompt) return;
    try {
      await remote.prompt();
    } catch {
      // User cancelled or not supported
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;

    // Video not mounted yet — retry until it is
    if (!video) {
      const interval = setInterval(() => {
        if (videoRef.current) {
          clearInterval(interval);
          // Re-trigger effect by forcing state update
          setIsAvailable(prev => prev);
        }
      }, 200);
      return () => clearInterval(interval);
    }

    const webkitVideo = video as WebKitVideoElement;

    // Safari / iOS — AirPlay
    if (
      (window as any).WebKitPlaybackTargetAvailabilityEvent ||
      webkitVideo.webkitShowPlaybackTargetPicker
    ) {
      // On iOS Safari, the picker works even if the event never fires
      // so we default to available and let the event refine it
      if (webkitVideo.webkitShowPlaybackTargetPicker) {
        isAirPlayRef.current = true;
        setIsAvailable(true);
      }

      const handleAvailability = (event: any) => {
        if (event.availability === 'available') {
          isAirPlayRef.current = true;
          setIsAvailable(true);
        } else {
          isAirPlayRef.current = false;
          setIsAvailable(false);
        }
      };

      const handleWirelessChanged = () => {
        setIsCasting(webkitVideo.webkitCurrentPlaybackTargetIsWireless ?? false);
      };

      video.addEventListener('webkitplaybacktargetavailabilitychanged', handleAvailability);
      video.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', handleWirelessChanged);

      return () => {
        video.removeEventListener('webkitplaybacktargetavailabilitychanged', handleAvailability);
        video.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', handleWirelessChanged);
      };
    }

    // Chrome — Remote Playback API
    const remote = (video as HTMLVideoElement & { remote?: RemotePlaybackAPI }).remote;

    const handleConnect = () => setIsCasting(true);
    const handleDisconnect = () => setIsCasting(false);

    // No remote API at all — show button anyway, prompt will just no-op gracefully
    if (!remote) {
      setIsAvailable(true);
      return;
    }

    if (!remote.watchAvailability) {
      setIsAvailable(true);
      remote.addEventListener?.('connect', handleConnect);
      remote.addEventListener?.('disconnect', handleDisconnect);
      return () => {
        remote.removeEventListener?.('connect', handleConnect);
        remote.removeEventListener?.('disconnect', handleDisconnect);
      };
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
        if (!cancelled) setIsAvailable(true);
      });

    remote.addEventListener?.('connect', handleConnect);
    remote.addEventListener?.('disconnect', handleDisconnect);

    return () => {
      cancelled = true;
      const id = watchIdRef.current;
      if (id != null && remote.cancelWatchAvailability) {
        remote.cancelWatchAvailability(id);
        watchIdRef.current = null;
      }
      remote.removeEventListener?.('connect', handleConnect);
      remote.removeEventListener?.('disconnect', handleDisconnect);
    };
  }, [videoRef.current]);

  return { isAvailable, isCasting, prompt };
}