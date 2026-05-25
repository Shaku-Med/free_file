/**
 * Per-session sliding-window counters that distinguish a real viewer (player
 * pulls segments at ~real-time pace, with small bursts to fill the buffer)
 * from a ripper (ffmpeg / extension grabbing as fast as the network allows).
 *
 * In-memory only  single-instance deploys. Swap for Redis when you scale out;
 * the API is intentionally tiny so the call sites don't change.
 */

const SEGMENT_WINDOW_MS = 45_000;
/** VoD seeks and ABR can burst many `.ts` requests in a few seconds; a low cap
 *  caused 429 → hls.js manifest reloads → playback death. Rippers still exceed
 *  this by orders of magnitude (full-speed parallel downloads). */
const SEGMENT_MAX_PER_WINDOW = 70;

const MANIFEST_WINDOW_MS = 60_000;
/** Master + variant playlists on recovery; keep headroom above error-retry storms. */
const MANIFEST_MAX_PER_WINDOW = 22;

const SWEEP_INTERVAL_MS = 60_000;

type Bucket = { times: number[] };
const segmentBuckets = new Map<string, Bucket>();
const manifestBuckets = new Map<string, Bucket>();
let lastSweepAt = 0;

function trimAndSweep(now: number) {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  const segCutoff = now - SEGMENT_WINDOW_MS;
  for (const [k, b] of segmentBuckets) {
    b.times = b.times.filter((t) => t > segCutoff);
    if (b.times.length === 0) segmentBuckets.delete(k);
  }
  const manCutoff = now - MANIFEST_WINDOW_MS;
  for (const [k, b] of manifestBuckets) {
    b.times = b.times.filter((t) => t > manCutoff);
    if (b.times.length === 0) manifestBuckets.delete(k);
  }
}

function record(
  store: Map<string, Bucket>,
  windowMs: number,
  max: number,
  key: string,
  now: number
): boolean {
  let bucket = store.get(key);
  if (!bucket) {
    bucket = { times: [] };
    store.set(key, bucket);
  }
  const cutoff = now - windowMs;
  bucket.times = bucket.times.filter((t) => t > cutoff);
  if (bucket.times.length >= max) return false;
  bucket.times.push(now);
  return true;
}

/** @returns true if the fetch is within budget; false if the session is rate-limited. */
export function recordSegmentFetch(sessionKey: string): boolean {
  const now = Date.now();
  trimAndSweep(now);
  return record(segmentBuckets, SEGMENT_WINDOW_MS, SEGMENT_MAX_PER_WINDOW, sessionKey, now);
}

/** @returns true if the fetch is within budget; false if the session is rate-limited. */
export function recordManifestFetch(sessionKey: string): boolean {
  const now = Date.now();
  trimAndSweep(now);
  return record(manifestBuckets, MANIFEST_WINDOW_MS, MANIFEST_MAX_PER_WINDOW, sessionKey, now);
}

/** Seconds until the oldest entry in the segment bucket falls out of the window. */
export function segmentRetryAfterSeconds(sessionKey: string): number {
  const b = segmentBuckets.get(sessionKey);
  if (!b || b.times.length === 0) return 1;
  const oldest = b.times[0];
  return Math.max(1, Math.ceil((oldest + SEGMENT_WINDOW_MS - Date.now()) / 1000));
}
