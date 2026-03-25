import { useState, useEffect, useCallback, useRef } from 'react';

interface RemotePlaybackAPI {
  state: 'connected' | 'connecting' | 'disconnected';
  watchAvailability: (cb: (available: boolean) => void) => Promise<number>;
  cancelWatchAvailability?: (id: number) => Promise<void>;
  prompt: () => Promise<void>;
  addEventListener: (event: string, cb: () => void) => void;
  removeEventListener: (event: string, cb: () => void) => void;
}

interface WebKitVideoElement extends HTMLVideoElement {
  webkitShowPlaybackTargetPicker?: () => void;
  webkitCurrentPlaybackTargetIsWireless?: boolean;
}

type VideoWithRemote = HTMLVideoElement & { remote?: RemotePlaybackAPI };

export function useRemotePlayback(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isCasting, setIsCasting] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  const isAirPlayRef = useRef(false);
  // Track whether the video element has been set up so we can re-run on mount
  const [videoMounted, setVideoMounted] = useState(false);

  // Poll until the video element is available
  useEffect(() => {
    if (videoRef.current) {
      setVideoMounted(true);
      return;
    }
    const interval = setInterval(() => {
      if (videoRef.current) {
        setVideoMounted(true);
        clearInterval(interval);
      }
    }, 200);
    return () => clearInterval(interval);
  }, [videoRef]);

  const prompt = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    const webkitVideo = video as WebKitVideoElement;
    if (isAirPlayRef.current && webkitVideo.webkitShowPlaybackTargetPicker) {
      webkitVideo.webkitShowPlaybackTargetPicker();
      return;
    }

    const remote = (video as VideoWithRemote).remote;
    if (remote?.prompt) {
      try {
        await remote.prompt();
      } catch {
        // User cancelled or not supported
      }
    }
  }, [videoRef]);

  useEffect(() => {
    if (!videoMounted) return;
    const video = videoRef.current;
    if (!video) return;

    const webkitVideo = video as WebKitVideoElement;

    // ─── Safari / iOS — AirPlay ───
    if (
      (window as any).WebKitPlaybackTargetAvailabilityEvent ||
      webkitVideo.webkitShowPlaybackTargetPicker
    ) {
      isAirPlayRef.current = true;
      setIsAvailable(true);

      // Check initial wireless state
      if (webkitVideo.webkitCurrentPlaybackTargetIsWireless) {
        setIsCasting(true);
      }

      const handleAvailability = (event: any) => {
        const available = event.availability === 'available';
        isAirPlayRef.current = available;
        setIsAvailable(available);
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

    // ─── Chrome / Edge — Remote Playback API ───
    const remote = (video as VideoWithRemote).remote;

    if (remote) {
      // Check initial state
      if (remote.state === 'connected') {
        setIsCasting(true);
        setIsAvailable(true);
      } else if (remote.state === 'connecting') {
        setIsCasting(false);
        setIsAvailable(true);
      }

      const handleConnect = () => setIsCasting(true);
      const handleDisconnect = () => setIsCasting(false);
      const handleConnecting = () => setIsCasting(false);

      remote.addEventListener('connect', handleConnect);
      remote.addEventListener('disconnect', handleDisconnect);
      remote.addEventListener('connecting', handleConnecting);

      if (remote.watchAvailability) {
        let cancelled = false;
        remote
          .watchAvailability((available: boolean) => {
            if (!cancelled) setIsAvailable(available);
          })
          .then((id: number) => {
            if (!cancelled) watchIdRef.current = id;
          })
          .catch(() => {
            // watchAvailability not supported — show button anyway
            if (!cancelled) setIsAvailable(true);
          });

        return () => {
          cancelled = true;
          const id = watchIdRef.current;
          if (id != null && remote.cancelWatchAvailability) {
            remote.cancelWatchAvailability(id);
            watchIdRef.current = null;
          }
          remote.removeEventListener('connect', handleConnect);
          remote.removeEventListener('disconnect', handleDisconnect);
          remote.removeEventListener('connecting', handleConnecting);
        };
      }

      // No watchAvailability — just show the button
      setIsAvailable(true);
      return () => {
        remote.removeEventListener('connect', handleConnect);
        remote.removeEventListener('disconnect', handleDisconnect);
        remote.removeEventListener('connecting', handleConnecting);
      };
    }

    // ─── Fallback: no remote API at all ───
    // On desktop browsers without Remote Playback API (Firefox, etc.),
    // don't show the button since there's nothing to cast to.
    setIsAvailable(false);
  }, [videoMounted, videoRef]);

  return { isAvailable, isCasting, prompt };
}
