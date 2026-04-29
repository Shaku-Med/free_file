import { useEffect, useRef } from 'react';
import { videoPlaybackDB } from '~/lib/Database/VideoPlaybackDB';
import { usePlayerContext } from '../PlayerContext';

export function usePlaybackPosition(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const { imageID, src, startTime } = usePlayerContext();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !imageID) return;

    const restore = async () => {
      try {
        if (typeof startTime === 'number' && startTime > 0) {
          const apply = () => {
            if (video.duration <= 0) return;
            const target = Math.min(startTime, video.duration - 1);
            // Global player may already be past this (e.g. stale prop / handoff); never seek backward.
            if (video.currentTime > target + 0.75) return;
            video.currentTime = target;
          };
          if (video.readyState >= 1 && video.duration > 0) {
            apply();
          } else {
            video.addEventListener('loadedmetadata', apply, { once: true });
          }
          return;
        }

        const saved = await videoPlaybackDB.getPosition(imageID);
        if (!saved || saved.currentTime <= 0) return;

        const apply = () => {
          if (video.duration <= 0) return;
          const nearEnd = saved.duration > 0 && saved.currentTime / saved.duration > 0.95;
          if (!nearEnd && saved.currentTime < video.duration) {
            const target = Math.min(saved.currentTime, video.duration - 1);
            if (video.currentTime > target + 0.75) return;
            video.currentTime = target;
          }
        };

        if (video.readyState >= 1 && video.duration > 0) {
          apply();
        } else {
          video.addEventListener('loadedmetadata', apply, { once: true });
        }
      } catch {}
    };

    restore();
  }, [imageID, startTime]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !imageID) return;

    const debouncedSave = () => {
      if (!video.duration || isNaN(video.currentTime)) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        videoPlaybackDB.savePosition(imageID, video.currentTime, video.duration, src).catch(() => {});
      }, 2000);
    };

    const immediateSave = () => {
      if (!video.duration || isNaN(video.currentTime)) return;
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
      videoPlaybackDB.savePosition(imageID, video.currentTime, video.duration, src).catch(() => {});
    };

    video.addEventListener('timeupdate', debouncedSave);
    video.addEventListener('pause', immediateSave);

    return () => {
      video.removeEventListener('timeupdate', debouncedSave);
      video.removeEventListener('pause', immediateSave);
      if (video.duration && !isNaN(video.currentTime)) {
        videoPlaybackDB.savePosition(imageID, video.currentTime, video.duration, src).catch(() => {});
      }
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [imageID, src]);
}
