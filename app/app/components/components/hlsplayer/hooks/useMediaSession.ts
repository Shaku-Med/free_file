import { useEffect, useRef } from 'react';
import { usePlayerContext } from '../PlayerContext';
import { ParseFilename } from '~/lib/utils';

export function useMediaSession(mediaSessionImage: string | null, videoRef: React.RefObject<HTMLVideoElement>) {
  const {  state, file, isReel } = usePlayerContext();
  const imageRef = useRef(mediaSessionImage);
  imageRef.current = mediaSessionImage;

  useEffect(() => {
    if (!('mediaSession' in navigator) || !file) return;

    const video = videoRef.current;
    if (!video) return;

    const update = () => {
      const title = file.file_title || ParseFilename(file.filename);
      navigator.mediaSession.metadata = new MediaMetadata({
        title: typeof title === 'string' ? title : (title as string[]).join(''),
        artist: file.owner?.username || 'Memories',
        artwork: imageRef.current
          ? [{ src: imageRef.current, sizes: '512x512', type: 'image/jpeg' }]
          : [],
      });

      navigator.mediaSession.setPositionState({
        duration: video.duration || 0,
        playbackRate: video.playbackRate || 1,
        position: Math.min(video.currentTime || 0, video.duration || 0),
      });

      navigator.mediaSession.playbackState = video.paused ? 'paused' : 'playing';
    };

    update();

    navigator.mediaSession.setActionHandler('play', () => video.play().catch(() => {}));
    navigator.mediaSession.setActionHandler('pause', () => video.pause());

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

    navigator.mediaSession.setActionHandler('stop', () => {
      video.pause();
      video.currentTime = 0;
    });

    const handleTimeUpdate = () => update();
    const handlePlayPause = () => update();

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', handlePlayPause);
    video.addEventListener('pause', handlePlayPause);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('play', handlePlayPause);
      video.removeEventListener('pause', handlePlayPause);
    };
  }, [file, isReel, state.isPlaying, mediaSessionImage]);
}
