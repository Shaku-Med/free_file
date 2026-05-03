import { useCallback, useEffect, useRef } from 'react';

interface UseWatchTimeOptions {
  fileId: string | null | undefined;
  userId: string | null | undefined;
  /** Interval in ms to send watch time updates. Default: 30000 (30s) */
  reportInterval?: number;
}

/**
 * Hook that tracks how long a user watches a video/file and reports it to the server.
 *
 * Usage:
 *   const { reportWatchTime } = useWatchTime({ fileId, userId });
 *   // Call reportWatchTime(currentTimeSeconds, durationSeconds) whenever playback progresses
 *   // The hook will batch and debounce reports automatically.
 *
 * This is the #1 signal for Instagram-style feed personalization.
 */
export function useWatchTime({ fileId, userId, reportInterval = 30000 }: UseWatchTimeOptions) {
  const accumulatedTimeRef = useRef(0);
  const lastReportTimeRef = useRef(0);
  const totalDurationRef = useRef(0);
  const lastTickRef = useRef(0);
  const reportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Send watch time to the server
  const sendWatchTime = useCallback(async () => {
    if (!fileId || !userId) return;
    if (accumulatedTimeRef.current <= 0) return;
    // Don't re-report if nothing changed since last report
    if (accumulatedTimeRef.current === lastReportTimeRef.current) return;

    const watchDuration = accumulatedTimeRef.current;
    const totalDuration = totalDurationRef.current;
    lastReportTimeRef.current = watchDuration;

    try {
      await fetch('/api/views/watch-time', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId,
          watchDurationSeconds: watchDuration,
          totalDurationSeconds: totalDuration,
        }),
      });
    } catch {
      // Silently fail — watch time is a best-effort signal
    }
  }, [fileId, userId]);

  // Called by the player when playback progresses
  const reportWatchTime = useCallback((currentTimeSeconds: number, durationSeconds: number) => {
    if (!fileId || !userId) return;

    totalDurationRef.current = durationSeconds || 0;

    // Track accumulated watch time (handles seeking by comparing deltas)
    const now = Date.now();
    const delta = lastTickRef.current > 0 ? (now - lastTickRef.current) / 1000 : 0;
    lastTickRef.current = now;

    // Only count time if the delta is reasonable (< 5s, meaning normal playback)
    // Large deltas indicate the tab was inactive or the user seeked
    if (delta > 0 && delta < 5) {
      accumulatedTimeRef.current += delta;
    }

    // Schedule periodic reporting
    if (!reportTimerRef.current) {
      reportTimerRef.current = setTimeout(() => {
        sendWatchTime();
        reportTimerRef.current = null;
      }, reportInterval);
    }
  }, [fileId, userId, reportInterval, sendWatchTime]);

  // Report on unmount / file change
  useEffect(() => {
    accumulatedTimeRef.current = 0;
    lastReportTimeRef.current = 0;
    lastTickRef.current = 0;

    return () => {
      if (reportTimerRef.current) {
        clearTimeout(reportTimerRef.current);
        reportTimerRef.current = null;
      }
      // Final report when leaving the page — fetch + keepalive (reliable JSON + cookies; avoids sendBeacon Blob quirks)
      if (accumulatedTimeRef.current > 2) {
        const payload = JSON.stringify({
          fileId,
          watchDurationSeconds: accumulatedTimeRef.current,
          totalDurationSeconds: totalDurationRef.current,
        });
        fetch('/api/views/watch-time', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    };
  }, [fileId]);

  return { reportWatchTime };
}
