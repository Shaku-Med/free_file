import { useEffect, useRef } from 'react';
import { videoPlaybackDB } from '~/lib/Database/VideoPlaybackDB';
import { useWatchProgressWriter } from '~/lib/Context/WatchProgressContext';
import { usePlayerContext } from '../PlayerContext';

const SERVER_SAVE_INTERVAL_MS = 10_000;

/** Fire-and-forget beacon, falling back to fetch when sendBeacon isn't available. */
function postProgressBeacon(uniqueId: string, currentTime: number, duration: number) {
  if (typeof window === 'undefined') return;
  try {
    const payload = JSON.stringify({ uniqueId, currentTime, duration });
    if (navigator?.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      const ok = navigator.sendBeacon('/api/watch-progress', blob);
      if (ok) return;
    }
    void fetch('/api/watch-progress', {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    }).catch(() => {});
  } catch {
    /* best-effort */
  }
}

export function usePlaybackPosition(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const { imageID, src, startTime, file } = usePlayerContext();
  const fileUuid = file?.id ?? null;
  const localSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastServerSaveRef = useRef(0);
  const seedProgressCache = useWatchProgressWriter();

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !imageID) return;
    let cancelled = false;

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

        const [localSaved, serverSaved] = await Promise.all([
          videoPlaybackDB.getPosition(imageID).catch(() => null),
          fileUuid ? fetchServerPosition(fileUuid).catch(() => null) : Promise.resolve(null),
        ]);
        if (cancelled) return;

        // Pick whichever endpoint last touched the row. Server wins on cross-device watching;
        // local wins when offline saves haven't synced yet.
        const localTs = localSaved?.timestamp ?? 0;
        const serverTs = serverSaved?.updatedAtMs ?? 0;
        const winner = serverTs > localTs ? serverSaved : localSaved;
        if (!winner) return;

        const winnerTime = 'currentTime' in winner ? winner.currentTime : 0;
        const winnerDuration =
          'duration' in winner ? winner.duration : (winner as { duration: number }).duration;
        if (winnerTime <= 0) return;

        const apply = () => {
          if (video.duration <= 0) return;
          const nearEnd = winnerDuration > 0 && winnerTime / winnerDuration > 0.95;
          if (!nearEnd && winnerTime < video.duration) {
            const target = Math.min(winnerTime, video.duration - 1);
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
    return () => {
      cancelled = true;
    };
  }, [imageID, startTime, fileUuid]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !imageID) return;
    lastServerSaveRef.current = 0;

    const persistLocal = () => {
      if (!video.duration || isNaN(video.currentTime)) return;
      videoPlaybackDB
        .savePosition(imageID, video.currentTime, video.duration, src)
        .catch(() => {});
    };

    const maybePersistServer = (force = false) => {
      if (!video.duration || isNaN(video.currentTime)) return;
      const now = Date.now();
      if (!force && now - lastServerSaveRef.current < SERVER_SAVE_INTERVAL_MS) return;
      lastServerSaveRef.current = now;
      postProgressBeacon(imageID, video.currentTime, video.duration);
      if (fileUuid && seedProgressCache) {
        seedProgressCache(fileUuid, {
          currentTime: video.currentTime,
          duration: video.duration,
          updatedAt: now,
        });
      }
    };

    const debouncedSave = () => {
      if (localSaveTimer.current) clearTimeout(localSaveTimer.current);
      localSaveTimer.current = setTimeout(() => {
        persistLocal();
        maybePersistServer(false);
      }, 2000);
    };

    const immediateSave = () => {
      if (localSaveTimer.current) {
        clearTimeout(localSaveTimer.current);
        localSaveTimer.current = null;
      }
      persistLocal();
      maybePersistServer(true);
    };

    video.addEventListener('timeupdate', debouncedSave);
    video.addEventListener('pause', immediateSave);

    return () => {
      video.removeEventListener('timeupdate', debouncedSave);
      video.removeEventListener('pause', immediateSave);
      if (video.duration && !isNaN(video.currentTime)) {
        videoPlaybackDB
          .savePosition(imageID, video.currentTime, video.duration, src)
          .catch(() => {});
        postProgressBeacon(imageID, video.currentTime, video.duration);
      }
      if (localSaveTimer.current) clearTimeout(localSaveTimer.current);
    };
  }, [imageID, src, fileUuid, seedProgressCache]);
}

async function fetchServerPosition(fileUuid: string): Promise<{
  currentTime: number;
  duration: number;
  updatedAtMs: number;
} | null> {
  if (typeof window === 'undefined') return null;
  try {
    const res = await fetch(
      `/api/watch-progress?fileIds=${encodeURIComponent(fileUuid)}`,
      { credentials: 'include' },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      progress?: Record<
        string,
        { currentTime: number; duration: number; updatedAt: string }
      >;
    };
    const row = json?.progress?.[fileUuid];
    if (!row) return null;
    const updatedAtMs = Date.parse(row.updatedAt);
    return {
      currentTime: Number(row.currentTime) || 0,
      duration: Number(row.duration) || 0,
      updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : 0,
    };
  } catch {
    return null;
  }
}
