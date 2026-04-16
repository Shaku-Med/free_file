/**
 * Max watch time (seconds) for signed-out viewers on a VOD, derived from total duration.
 * Example: 2 min → 30s (duration/4). Long videos cap at 10 minutes.
 */
export function computeGuestPreviewSeconds(durationSeconds: number): number {
  const d = Number(durationSeconds);
  if (!Number.isFinite(d) || d <= 0) return 30;
  const quarter = d / 4;
  const capped = Math.min(10 * 60, quarter);
  return Math.max(30, Math.round(capped));
}
