/**
 * Server-analyzed audio stems (kick/snare/hihat/bass onsets + per-band wave
 * envelopes) produced by GoUpload as `audio_stems.json`. The visualizer prefers
 * `envelopes` for smooth single-line waves; older uploads fall back to onset
 * events synthesized on the client.
 */

export const STEM_TYPES = ['kick', 'snare', 'hihat', 'bass', 'other'] as const;
export type StemType = (typeof STEM_TYPES)[number];

export type StemEvent = {
  /** Seconds from media start. */
  t: number;
  type: StemType;
  /** Onset strength 0..1. */
  s: number;
};

export type AudioStems = {
  version: number;
  hasAudio: boolean;
  duration: number;
  events: StemEvent[];
  /** Samples per second for `envelopes` (present on v2+ uploads). */
  envelopeFps: number | null;
  /** Normalized 0..1 wave amplitude per instrument band. */
  envelopes: Partial<Record<StemType, number[]>> | null;
};

const MAX_EVENTS = 20_000;

const stemsCache = new Map<string, AudioStems>();
const inflight = new Map<string, Promise<AudioStems | null>>();
const missingUrls = new Set<string>();

const stemTypeSet = new Set<string>(STEM_TYPES);

function parseEnvelopes(raw: Record<string, unknown>): {
  envelopeFps: number | null;
  envelopes: Partial<Record<StemType, number[]>> | null;
} {
  const fpsRaw = raw.envelope_fps;
  const envelopeFps =
    typeof fpsRaw === 'number' && Number.isFinite(fpsRaw) && fpsRaw > 0 ? fpsRaw : null;
  const envRaw = raw.envelopes;
  if (envelopeFps == null || !envRaw || typeof envRaw !== 'object') {
    return { envelopeFps: null, envelopes: null };
  }

  const envelopes: Partial<Record<StemType, number[]>> = {};
  let hasAny = false;
  for (const type of STEM_TYPES) {
    const arr = (envRaw as Record<string, unknown>)[type];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const out: number[] = [];
    for (const v of arr) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      out.push(Math.max(0, Math.min(1, v)));
    }
    if (out.length > 0) {
      envelopes[type] = out;
      hasAny = true;
    }
  }

  return {
    envelopeFps,
    envelopes: hasAny ? envelopes : null,
  };
}

function parseStems(raw: unknown): AudioStems | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  if (data.has_audio !== true) return null;
  if (!Array.isArray(data.events)) return null;

  const events: StemEvent[] = [];
  for (const item of data.events.slice(0, MAX_EVENTS)) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    const t = typeof e.t === 'number' && Number.isFinite(e.t) ? e.t : null;
    const type = typeof e.type === 'string' && stemTypeSet.has(e.type) ? (e.type as StemType) : null;
    if (t === null || t < 0 || type === null) continue;
    const sRaw = typeof e.s === 'number' && Number.isFinite(e.s) ? e.s : 0.5;
    events.push({ t, type, s: Math.max(0, Math.min(1, sRaw)) });
  }
  if (events.length === 0) return null;
  events.sort((a, b) => a.t - b.t);

  const { envelopeFps, envelopes } = parseEnvelopes(data);

  return {
    version: typeof data.version === 'number' ? data.version : 1,
    hasAudio: true,
    duration: typeof data.duration === 'number' && Number.isFinite(data.duration) ? data.duration : 0,
    events,
    envelopeFps,
    envelopes,
  };
}

export async function fetchAudioStems(url: string): Promise<AudioStems | null> {
  if (missingUrls.has(url)) return null;
  const cached = stemsCache.get(url);
  if (cached) return cached;
  const pending = inflight.get(url);
  if (pending) return pending;

  const markMissing = () => {
    missingUrls.add(url);
    return null;
  };

  const promise = (async () => {
    try {
      const res = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
      if (!res.ok) return markMissing();
      const stems = parseStems(await res.json());
      if (!stems) return markMissing();
      stemsCache.set(url, stems);
      return stems;
    } catch {
      return markMissing();
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, promise);
  return promise;
}

/** Index of the first event with t >= time (binary search). */
export function stemEventIndexAt(events: StemEvent[], time: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid]!.t < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Linearly interpolated envelope sample at `time` (seconds). */
export function stemEnvelopeAt(
  envelope: number[] | undefined,
  envelopeFps: number,
  time: number,
): number {
  if (!envelope || envelope.length === 0 || envelopeFps <= 0 || time < 0) return 0;
  const idx = time * envelopeFps;
  const i0 = Math.floor(idx);
  if (i0 >= envelope.length - 1) {
    return envelope[envelope.length - 1] ?? 0;
  }
  const frac = idx - i0;
  const v0 = envelope[i0] ?? 0;
  const v1 = envelope[i0 + 1] ?? v0;
  return v0 + (v1 - v0) * frac;
}

export function stemsHaveWaveEnvelopes(stems: AudioStems): boolean {
  if (stems.envelopeFps == null || !stems.envelopes) return false;
  return STEM_TYPES.some((t) => (stems.envelopes?.[t]?.length ?? 0) > 0);
}
