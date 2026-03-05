import { useEffect, useCallback, useRef } from 'react';
import { usePlayerContext } from '../PlayerContext';

export function useVideoEvents(videoRef: React.RefObject<HTMLVideoElement>, callbacks?: {
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
      setState(s => ({ ...s, isPlaying: false, isPaused: true }));
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

    const onTimeUpdate = () => {
      setState(s => ({
        ...s,
        currentTime: video.currentTime,
        duration: video.duration || 0,
      }));
    };

    const onLoadedMetadata = () => {
      setState(s => ({
        ...s,
        isLoaded: true,
        duration: video.duration || 0,
      }));
    };

    const onCanPlay = () => {
      setState(s => ({ ...s, isBuffering: false }));
    };

    const onCanPlayThrough = () => {
      setState(s => ({ ...s, isBuffering: false }));
    };

    const onWaiting = () => {
      if (!video.paused || video.readyState < 3) {
        setState(s => ({ ...s, isBuffering: true }));
      }
    };

    const onPlaying = () => {
      setState(s => ({ ...s, isBuffering: false }));
    };

    const onProgress = () => {
      if (video.buffered.length > 0) {
        const end = video.buffered.end(video.buffered.length - 1);
        setState(s => ({ ...s, buffered: end }));
      }
    };

    const onVolumeChange = () => {
      setState(s => ({ ...s, volume: video.volume, isMuted: video.muted }));
    };

    const onRateChange = () => {
      setState(s => ({ ...s, playbackRate: video.playbackRate }));
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

    return () => {
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
    };
  }, [videoRef, setState]);
}
