import { useEffect, useState } from 'react';
import { autoplayService } from '~/lib/Services/AutoplayService';
import { usePictureInPictureContext } from '~/lib/Context/PictureInPictureContext';
import { usePlayerContext } from '../PlayerContext';

/** Returns true when the video is streaming via AirPlay or Remote Playback (Cast). */
function isRemotePlaybackActive(video: HTMLVideoElement): boolean {
  // Safari / iOS  AirPlay
  if ((video as any).webkitCurrentPlaybackTargetIsWireless) return true;
  // Chrome / Edge  Remote Playback API
  if ((video as any).remote?.state === 'connected') return true;
  return false;
}

export function useAutoplay(
  autoPlay: boolean,
  videoRef: React.RefObject<HTMLVideoElement | null>,
  options?: { muteVideoWhenAutoplayDisabled?: boolean },
) {
  const muteVideoWhenAutoplayDisabled = options?.muteVideoWhenAutoplayDisabled !== false;
  const { imageID, src } = usePlayerContext();
  const { isPipActive, isContentInPip, pipContentId } = usePictureInPictureContext();
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Never disrupt an active AirPlay / Cast session.
    // Check both current state AND whether we're mid-connection.
    if (isRemotePlaybackActive(video)) return;

    if (!autoPlay) {
      // Only pause if we're NOT casting. Re-check right before mutating.
      if (isRemotePlaybackActive(video)) return;
      /** Native / WebKit PiP keeps using this `<video>`  don't pause or mute it when autoplay prefs are off. */
      if (pipContentId === imageID) return;
      if (!video.paused) video.pause();
      /** Never force-mute here: "autoplay off" is about not calling play(), not overriding saved volume/mute.
       *  Forcing mute caused a loop when this effect re-ran after the user unmuted (e.g. isMuted in deps). */
      setAutoplayBlocked(false);
      setShowPrompt(false);
      return;
    }

    const attemptPlay = async () => {
      // Re-check: AirPlay could have connected while waiting for canplay
      if (isRemotePlaybackActive(video)) return;
      if (isPipActive && !isContentInPip(imageID)) return;

      if (autoplayService.isAutoplayEnabled()) {
        const success = await autoplayService.attemptAutoplayWithSound(video);
        if (!success && !video.muted) {
          setAutoplayBlocked(true);
          setShowPrompt(true);
        } else if (success) {
          setAutoplayBlocked(false);
          setShowPrompt(false);
        }
      } else {
        try {
          await video.play();
        } catch (e: any) {
          if (e.name === 'NotAllowedError') {
            setAutoplayBlocked(true);
            setShowPrompt(true);
          }
        }
      }
    };

    if (video.readyState >= 2) {
      attemptPlay();
    } else {
      video.addEventListener('canplay', attemptPlay, { once: true });
      return () => video.removeEventListener('canplay', attemptPlay);
    }
  }, [autoPlay, muteVideoWhenAutoplayDisabled, isPipActive, imageID, src, pipContentId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // Don't pause for PiP logic while AirPlay / Cast is active
    if (isRemotePlaybackActive(video)) return;
    if (isPipActive && !isContentInPip(imageID) && !video.paused) {
      video.pause();
    }
  }, [isPipActive, imageID]);

  const enableAutoplay = async () => {
    autoplayService.enableAutoplay();
    setShowPrompt(false);
    const video = videoRef.current;
    if (video) {
      video.muted = false;
      try {
        await video.play();
        setAutoplayBlocked(false);
      } catch {}
    }
  };

  const dismissPrompt = () => {
    setShowPrompt(false);
    const video = videoRef.current;
    if (video && !video.paused && muteVideoWhenAutoplayDisabled) {
      video.muted = true;
    }
  };

  return { autoplayBlocked, showPrompt, enableAutoplay, dismissPrompt };
}
