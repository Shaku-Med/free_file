import { useEffect, useState } from 'react';
import { autoplayService } from '~/lib/Services/AutoplayService';
import { usePictureInPictureContext } from '~/lib/Context/PictureInPictureContext';
import { usePlayerContext } from '../PlayerContext';

export function useAutoplay(autoPlay: boolean) {
  const { videoRef, imageID } = usePlayerContext();
  const { isPipActive, isContentInPip } = usePictureInPictureContext();
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!autoPlay) {
      if (!video.paused) video.pause();
      video.muted = true;
      setAutoplayBlocked(false);
      setShowPrompt(false);
      return;
    }

    const attemptPlay = async () => {
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
  }, [autoPlay, isPipActive, imageID]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
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
    if (video && !video.paused) video.muted = true;
  };

  return { autoplayBlocked, showPrompt, enableAutoplay, dismissPrompt };
}
