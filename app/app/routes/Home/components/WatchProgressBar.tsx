import { useWatchProgress } from '~/lib/Context/WatchProgressContext';

interface WatchProgressBarProps {
  /** File identifier used as cache/API key. Supports `files.id` or `files.unique_id`. */
  fileId: string | null | undefined;
  /** Optional duration fallback when the user has never finished a view (server-stored duration may be 0). */
  fallbackDuration?: number | null;
}

/**
 * Thin red progress strip along the bottom of a video card thumbnail (YouTube style).
 * Reads from the shared `WatchProgressContext` — only renders when the user has watched
 * this file. Renders nothing for guests, never-watched files, or files where we can't
 * derive a fraction yet.
 */
export default function WatchProgressBar({ fileId, fallbackDuration }: WatchProgressBarProps) {
  const entry = useWatchProgress(fileId);
  if (!entry) return null;
  const duration =
    entry.duration > 0
      ? entry.duration
      : fallbackDuration && fallbackDuration > 0
        ? fallbackDuration
        : 0;
  if (duration <= 0 || entry.currentTime <= 0) return null;
  const pct = Math.min(100, Math.max(0, (entry.currentTime / duration) * 100));
  if (pct < 0.5) return null;
  return (
    <div
      className="pointer-events-none absolute bottom-0 left-0 right-0 z-[21] h-[3px] bg-black/55"
      aria-hidden
    >
      <div className="h-full bg-destructive" style={{ width: `${pct}%` }} />
    </div>
  );
}
