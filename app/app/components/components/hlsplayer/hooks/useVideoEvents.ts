import { useEffect, useRef } from 'react';
import { usePlayerContext } from '../PlayerContext';

export function useVideoEvents(videoRef: React.RefObject<HTMLVideoElement | null>, callbacks?: {
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onError?: (e: any) => void;
}) {
  const { setState } = usePlayerContext();
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => {
      setState(s => ({ ...s, isPlaying: true, isPaused: false, isBuffering: false, isEnded: false }));
      cbRef.current?.onPlay?.();
    };

    const onPause = () => {
      setState(s => ({
        ...s,
        isPlaying: false,
        isPaused: true,
        currentTime: video.currentTime,
        duration: video.duration || 0,
      }));
      cbRef.current?.onPause?.();
    };

    const onEnded = () => {
      setState(s => ({ ...s, isPlaying: false, isPaused: true, isEnded: true }));
      cbRef.current?.onEnded?.();
    };

    const onError = (e: any) => {
      setState(s => ({ ...s, hasError: true }));
      cbRef.current?.onError?.(e);
    };

    let timeRafId = 0;
    const onTimeUpdate = () => {
      if (timeRafId) return;
      timeRafId = requestAnimationFrame(() => {
        timeRafId = 0;
        setState(s => {
          const ct = video.currentTime;
          const dur = video.duration || 0;
          if (Math.abs(s.currentTime - ct) < 0.25 && Math.abs(s.duration - dur) < 0.5) return s;
          return { ...s, currentTime: ct, duration: dur };
        });
      });
    };

    const onLoadedMetadata = () => {
      setState(s => ({
        ...s,
        isLoaded: true,
        duration: video.duration || 0,
      }));
    };

    const onCanPlay = () => {
      setState(s => s.isBuffering ? { ...s, isBuffering: false } : s);
    };

    const onCanPlayThrough = () => {
      setState(s => s.isBuffering ? { ...s, isBuffering: false } : s);
    };

    const onWaiting = () => {
      if (!video.paused || video.readyState < 3) {
        setState(s => s.isBuffering ? s : { ...s, isBuffering: true });
      }
    };

    const onPlaying = () => {
      setState(s => s.isBuffering ? { ...s, isBuffering: false } : s);
    };

    let progressRafId = 0;
    const onProgress = () => {
      if (progressRafId) return;
      progressRafId = requestAnimationFrame(() => {
        progressRafId = 0;
        const ranges: { start: number; end: number }[] = [];
        for (let i = 0; i < video.buffered.length; i++) {
          ranges.push({ start: video.buffered.start(i), end: video.buffered.end(i) });
        }
        setState(s => ({ ...s, bufferedRanges: ranges }));
      });
    };

    const onVolumeChange = () => {
      setState(s => ({ ...s, volume: video.volume, isMuted: video.muted }));
    };

    const onRateChange = () => {
      setState(s => ({ ...s, playbackRate: video.playbackRate }));
    };

    const onSeeked = () => {
      setState(s => ({
        ...s,
        currentTime: video.currentTime,
        duration: video.duration || 0,
      }));
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('canplaythrough', onCanPlayThrough);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('progress', onProgress);
    video.addEventListener('volumechange', onVolumeChange);
    video.addEventListener('ratechange', onRateChange);
    video.addEventListener('seeked', onSeeked);

    return () => {
      if (timeRafId) cancelAnimationFrame(timeRafId);
      if (progressRafId) cancelAnimationFrame(progressRafId);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('canplaythrough', onCanPlayThrough);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('progress', onProgress);
      video.removeEventListener('volumechange', onVolumeChange);
      video.removeEventListener('ratechange', onRateChange);
      video.removeEventListener('seeked', onSeeked);
    };
  }, [videoRef, setState]);
}
