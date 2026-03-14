import { useEffect, useRef, useCallback } from 'react';
import { usePlayerContext } from '../PlayerContext';
import { ParseFilename } from '~/lib/utils';

export function useMediaSession(mediaSessionImage: string | null, videoRef: React.RefObject<HTMLVideoElement>) {
  const { file, isReel } = usePlayerContext();
  const imageRef = useRef(mediaSessionImage);
  imageRef.current = mediaSessionImage;
  const fileRef = useRef(file);
  fileRef.current = file;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const updateMetadata = useCallback(() => {
    if (!('mediaSession' in navigator) || !mountedRef.current) return;
    const currentFile = fileRef.current;
    const video = videoRef.current;
    if (!currentFile || !video) return;

    const title = currentFile.file_title || ParseFilename(currentFile.filename);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: typeof title === 'string' ? title : (title as string[]).join(''),
      artist: currentFile.owner?.username || 'Memories',
      artwork: imageRef.current
        ? [{ src: imageRef.current, sizes: '512x512', type: 'image/jpeg' }]
        : [],
    });

    try {
      const dur = video.duration;
      if (Number.isFinite(dur) && dur > 0) {
        navigator.mediaSession.setPositionState({
          duration: dur,
          playbackRate: video.playbackRate || 1,
          position: Math.min(Math.max(video.currentTime || 0, 0), dur),
        });
      }
    } catch {}

    navigator.mediaSession.playbackState = video.paused ? 'paused' : 'playing';
  }, [videoRef]);

  useEffect(() => {
    if (mediaSessionImage) updateMetadata();
  }, [mediaSessionImage, updateMetadata]);

  useEffect(() => {
    if (!('mediaSession' in navigator) || !file) return;

    const video = videoRef.current;
    if (!video) return;

    updateMetadata();

    const playHandler = () => video.play().catch(() => {});
    const pauseHandler = () => video.pause();
    const stopHandler = () => { video.pause(); video.currentTime = 0; };

    navigator.mediaSession.setActionHandler('play', playHandler);
    navigator.mediaSession.setActionHandler('pause', pauseHandler);
    navigator.mediaSession.setActionHandler('stop', stopHandler);

    if (!isReel) {
      navigator.mediaSession.setActionHandler('seekbackward', (d) => {
        video.currentTime = Math.max(video.currentTime - (d.seekOffset || 10), 0);
      });
      navigator.mediaSession.setActionHandler('seekforward', (d) => {
        video.currentTime = Math.min(video.currentTime + (d.seekOffset || 10), video.duration);
      });
      navigator.mediaSession.setActionHandler('seekto', (d) => {
        if (d.seekTime != null) video.currentTime = d.seekTime;
      });
    }

    const handlePlayPause = () => updateMetadata();
    const handleLoadedMetadata = () => updateMetadata();

    video.addEventListener('play', handlePlayPause);
    video.addEventListener('pause', handlePlayPause);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      video.removeEventListener('play', handlePlayPause);
      video.removeEventListener('pause', handlePlayPause);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [file, isReel, videoRef, updateMetadata]);
}
