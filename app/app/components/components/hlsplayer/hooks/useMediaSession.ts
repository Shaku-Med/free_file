import { useEffect, useRef, useCallback } from 'react';
import { usePlayerContext } from '../PlayerContext';
import { ParseFilename } from '~/lib/utils';

export type MediaSessionPlaylistHandlers = {
  canNext: boolean;
  canPrevious: boolean;
  onNext: () => void;
  onPrevious: () => void;
};

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
    // Artwork ladder for receivers to pick from:
    //   1. Original HTTP poster URL  Cast / AirPlay can fetch this over
    //      the network even when the HLS video stream is unreachable, so
    //      the TV shows the cover image as a fallback. Listed FIRST and
    //      with a larger size hint so receivers prefer it for the big-art
    //      slot. Some receivers also reject blob: URLs entirely.
    //   2. The square canvas-cropped blob URL  best for the OS
    //      notification / lock-screen widget where a square 512 wins.
    //
    // Listing both is per-spec; receivers pick by sizes / capability.
    const artwork: MediaImage[] = [];
    if (posterHttpRef.current) {
      artwork.push({
        src: posterHttpRef.current,
        // 1280×720 hint matches our default thumbnail size; receivers
        // that ask for "largest" art pick this entry.
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
      title: typeof title === 'string' ? title : (title as string[]).join(''),
      artist: currentFile.owner?.username || 'Memories',
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
    } catch {}

    navigator.mediaSession.playbackState = video.paused ? 'paused' : 'playing';
  }, [videoRef]);

  useEffect(() => {
    // Re-publish metadata whenever EITHER artwork URL changes so the OS
    // / cast receiver picks up the new entry. Previously we only fired
    // on the blob URL changing, which meant a posterHttpUrl that landed
    // first (or alone) never reached MediaSession.
    if (mediaSessionImage || posterHttpUrl) updateMetadata();
  }, [mediaSessionImage, posterHttpUrl, updateMetadata]);

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

      registerMediaSessionTrackHandlers();
    } else {
      try {
        navigator.mediaSession.setActionHandler('nexttrack', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
      } catch {
        /* unsupported or read-only */
      }
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
      } catch {
        /* noop */
      }
      try {
        if (pl?.canPrevious) {
          navigator.mediaSession.setActionHandler('previoustrack', () => {
            playlistRef.current?.onPrevious();
          });
        } else {
          navigator.mediaSession.setActionHandler('previoustrack', null);
        }
      } catch {
        /* noop */
      }
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
      try {
        navigator.mediaSession.setActionHandler('nexttrack', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
      } catch {
        /* noop */
      }
    };
  }, [
    file,
    isReel,
    videoRef,
    updateMetadata,
    playlist?.canNext,
    playlist?.canPrevious,
  ]);
}
