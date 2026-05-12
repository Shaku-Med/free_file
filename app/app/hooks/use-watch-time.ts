/**
 * @deprecated Unused. Watch time is recorded via `components/components/hlsplayer/hooks/useWatchTimeHeartbeat`.
 * `/api/views/watch-time` requires a one-time chained `playbackToken` from `/api/views/watch-issue` (no trusted `fileId` in POST body).
 */

export interface UseWatchTimeOptions {
  fileId?: string | null | undefined;
  userId?: string | null | undefined;
  /** @deprecated Unused */
  reportInterval?: number;
}

/**
 * Stub kept so accidental imports fail silently at compile time but don't hit the API incorrectly.
 */
export function useWatchTime(_options?: UseWatchTimeOptions) {
  return {
    reportWatchTime(_currentTimeSeconds?: number, _durationSeconds?: number): void {},
  };
}
