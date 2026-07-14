import { useEffect, useRef, useCallback } from 'react';
import { usePlayerContext } from '../PlayerContext';
import { ParseFilename } from '~/lib/utils';

export type MediaSessionPlaylistHandlers = {
  canNext: boolean;
  canPrevious: boolean;
  onNext: () => void;
  onPrevious: () => void;
};

function syncWindappThumbar(opts: {
  playing: boolean;
  canNext: boolean;
  canPrevious: boolean;
  progress?: number;
  title?: string;
}) {
  const api = typeof window !== 'undefined' ? window.memoriesWindapp : undefined;
  if (!api?.setMediaState) return;
  void api.setMediaState(opts);
}

export function useMediaSession(
  mediaSessionImage: string | null,
  videoRef: React.RefObject<HTMLVideoElement | null>,
  /** When set and not a reel, registers Media Session next / previous track actions. */
  playlist: MediaSessionPlaylistHandlers | null = null,
  /**
   * Absolute HTTP URL to the original poster image (NOT the canvas-cropped
   * blob). Cast / AirPlay receivers can fetch this directly so the TV can
   * display the poster as a fallback when the HLS video stream isn't
   * reachable. `mediaSessionImage` (the square blob) stays in the artwork
   * array for the OS notification UI which renders best at 512×512.
   */
  posterHttpUrl: string | null = null,
  /**
   * Whether THIS player currently owns the (singleton) Media Session. In the
   * reel swiper several players are mounted at once; only the active slide may
   * publish, otherwise a neighbor finishing its load overwrites the lock-screen
   * metadata with the wrong video. Always true for the single watch-page player.
   */
  active: boolean = true,
) {
  const { file, isReel } = usePlayerContext();
  const imageRef = useRef(mediaSessionImage);
  imageRef.current = mediaSessionImage;
  const posterHttpRef = useRef(posterHttpUrl);
  posterHttpRef.current = posterHttpUrl;
  const fileRef = useRef(file);
  fileRef.current = file;
  const playlistRef = useRef<MediaSessionPlaylistHandlers | null>(playlist);
  playlistRef.current = playlist;
  const activeRef = useRef(active);
  activeRef.current = active;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const updateMetadata = useCallback(() => {
    if (!('mediaSession' in navigator) || !mountedRef.current) return;
    if (!activeRef.current) return;
    const currentFile = fileRef.current;
    const video = videoRef.current;
    if (!currentFile || !video) return;

    const title = currentFile.file_title || ParseFilename(currentFile.filename);
    const titleStr = typeof title === 'string' ? title : (title as string[]).join('');
    const artwork: MediaImage[] = [];
    if (posterHttpRef.current) {
      artwork.push({
        src: posterHttpRef.current,
        sizes: '1280x720',
        type: 'image/jpeg',
      });
    }
    if (imageRef.current) {
      artwork.push({
        src: imageRef.current,
        sizes: '512x512',
        type: 'image/jpeg',
      });
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: titleStr,
      artist: currentFile.owner?.username || 'Memories',
      album: 'Memories',
      artwork,
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
    } catch { /* position unsupported */ }

    const playing = !video.paused && !video.ended;
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';

    const pl = playlistRef.current;
    const progress =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.currentTime / video.duration
        : 0;
    syncWindappThumbar({
      playing,
      canNext: Boolean(pl?.canNext),
      canPrevious: Boolean(pl?.canPrevious),
      progress,
      title: titleStr,
    });
  }, [videoRef]);

  useEffect(() => {
    if (mediaSessionImage || posterHttpUrl) updateMetadata();
  }, [mediaSessionImage, posterHttpUrl, updateMetadata]);

  useEffect(() => {
    if (!('mediaSession' in navigator) || !file || !active) {
      if (!active) {
        void window.memoriesWindapp?.clearMediaState?.();
      }
      return;
    }

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

      registerMediaSessionTrackHandlers();
    } else {
      try {
        navigator.mediaSession.setActionHandler('nexttrack', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
      } catch { /* unsupported */ }
    }

    function registerMediaSessionTrackHandlers() {
      const pl = playlistRef.current;
      try {
        if (pl?.canNext) {
          navigator.mediaSession.setActionHandler('nexttrack', () => {
            playlistRef.current?.onNext();
          });
        } else {
          navigator.mediaSession.setActionHandler('nexttrack', null);
        }
      } catch { /* noop */ }
      try {
        if (pl?.canPrevious) {
          navigator.mediaSession.setActionHandler('previoustrack', () => {
            playlistRef.current?.onPrevious();
          });
        } else {
          navigator.mediaSession.setActionHandler('previoustrack', null);
        }
      } catch { /* noop */ }
    }

    const handlePlayPause = () => updateMetadata();
    const handleLoadedMetadata = () => updateMetadata();
    let lastPosSync = 0;
    const handleTimeUpdate = () => {
      const now = Date.now();
      if (now - lastPosSync < 1000) return;
      lastPosSync = now;
      updateMetadata();
    };

    video.addEventListener('play', handlePlayPause);
    video.addEventListener('pause', handlePlayPause);
    video.addEventListener('ended', handlePlayPause);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('timeupdate', handleTimeUpdate);

    // Taskbar thumbnail buttons (Electron / windapp) → same handlers as Media Session.
    const unsubThumbar = window.memoriesWindapp?.onMediaAction?.((action) => {
      if (!activeRef.current) return;
      if (action === 'play') playHandler();
      else if (action === 'pause') pauseHandler();
      else if (action === 'nexttrack') playlistRef.current?.onNext();
      else if (action === 'previoustrack') playlistRef.current?.onPrevious();
    });

    return () => {
      video.removeEventListener('play', handlePlayPause);
      video.removeEventListener('pause', handlePlayPause);
      video.removeEventListener('ended', handlePlayPause);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      unsubThumbar?.();
      try {
        navigator.mediaSession.setActionHandler('nexttrack', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
      } catch { /* noop */ }
      void window.memoriesWindapp?.clearMediaState?.();
    };
  }, [
    file,
    isReel,
    active,
    videoRef,
    updateMetadata,
    playlist?.canNext,
    playlist?.canPrevious,
  ]);
}
