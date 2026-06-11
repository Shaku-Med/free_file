import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { usePlayerContext } from '../../PlayerContext';
import {
  STEM_TYPES,
  stemEnvelopeAt,
  stemEventIndexAt,
  stemsHaveWaveEnvelopes,
  type AudioStems,
  type StemType,
} from '../../audioStems';
import {
  buildStemConfettiThemePalettes,
  type StemConfettiThemePalettes,
} from '../../stemConfettiSettings';
import { fileAccentColors } from '../../visualizerPalette';

/**
 * Standing single-line audio wave (SVG, no canvas, no AnalyserNode).
 *
 * The wave does NOT scroll: it stands in place and pulses with the music at
 * the playhead. Hit hardness drives BOTH height and peak sharpness — a hard
 * kick throws tall, narrow spikes; quiet passages settle into a small round
 * ripple. Amplitude and drift ride critically-under-damped springs, so the
 * wave overshoots and settles with real momentum instead of snapping.
 *
 * Colors come from the FILE's own extracted dominant colors (files.colors,
 * pulled by GoUpload at upload time), so the wave matches the video. Falls
 * back to the stem theme palette when a file has no colors.
 *
 * Data: per-band envelopes from audio_stems.json v2 when present; otherwise
 * amplitude is synthesized from the onset events (older uploads).
 *
 * CPU: path `d` written straight to the DOM in the rAF (no React re-renders
 * per frame), rebuilt at ~30fps with reused Float32Array buffers.
 */

const SAMPLE_COUNT = 96;
const FRAME_BUDGET_MS = 33;
/** Full sine cycles across the strip at rest. */
const BASE_CYCLES = 3;

/** Amplitude spring: stiff attack, soft overshoot = momentum. */
const AMP_STIFFNESS = 90;
const AMP_DAMPING = 11;
/** Phase drift accelerates with energy; velocity eases for inertia. */
const DRIFT_BASE = 1.4;
const DRIFT_ENERGY = 6.5;
const DRIFT_EASE = 2.2;
/** Sharpness eases fast on hits, relaxes slow — spikes linger briefly. */
const SHARP_ATTACK = 14;
const SHARP_RELEASE = 3.5;

const LIVE_DECAY = 0.9;
const LIVE_ATTACK = 0.5;
/** Resting ripple so a paused/quiet player still reads as a wave. */
const IDLE_AMP = 0.035;

/** Blend weights: lows carry the body of the wave, highs add sparkle. */
const BAND_WEIGHT: Record<StemType, number> = {
  kick: 0.34,
  bass: 0.24,
  snare: 0.18,
  other: 0.14,
  hihat: 0.1,
};

type BandAmps = Record<StemType, number>;

function eventSpikeAmplitude(
  type: StemType,
  events: AudioStems['events'],
  t: number,
  liveAmp: number,
): number {
  let amp = liveAmp * 0.75;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type !== type) continue;
    const dt = t - e.t;
    if (dt < -0.04 || dt > 0.35) continue;
    amp += e.s * Math.exp(-Math.abs(dt) * 14);
  }
  return Math.min(1.15, amp);
}

function bandAmpsAt(
  stems: AudioStems,
  t: number,
  live: BandAmps,
  useEnvelopes: boolean,
  out: BandAmps,
): BandAmps {
  for (const type of STEM_TYPES) {
    if (useEnvelopes && stems.envelopeFps != null) {
      const wave = stemEnvelopeAt(stems.envelopes?.[type], stems.envelopeFps, t);
      out[type] = Math.min(1.15, Math.max(wave, (live[type] ?? 0) * 0.7));
    } else {
      out[type] = eventSpikeAmplitude(type, stems.events, t, live[type] ?? 0);
    }
  }
  return out;
}

function combinedAmplitude(bands: BandAmps): number {
  let sum = 0;
  for (const type of STEM_TYPES) sum += (bands[type] ?? 0) * BAND_WEIGHT[type];
  return Math.min(1, Math.pow(sum * 1.45, 0.85));
}

/** Hit hardness: how much percussive punch is in this instant (0..1). */
function hardnessAmount(bands: BandAmps): number {
  return Math.min(
    1,
    (bands.kick ?? 0) * 0.7 + Math.max(bands.snare ?? 0, bands.hihat ?? 0) * 0.5,
  );
}

/** Sign-preserving power shaping: p > 1 = tall narrow spikes, p = 1 = pure sine. */
function shapePeak(s: number, p: number): number {
  return Math.sign(s) * Math.pow(Math.abs(s), p);
}

function buildSmoothLinePath(xs: Float32Array, ys: Float32Array, n: number): string {
  if (n < 2) return '';
  let d = `M ${xs[0]!.toFixed(1)} ${ys[0]!.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const i0 = Math.max(0, i - 1);
    const i3 = Math.min(n - 1, i + 2);
    const cp1x = xs[i]! + (xs[i + 1]! - xs[i0]!) / 6;
    const cp1y = ys[i]! + (ys[i + 1]! - ys[i0]!) / 6;
    const cp2x = xs[i + 1]! - (xs[i3]! - xs[i]!) / 6;
    const cp2y = ys[i + 1]! - (ys[i3]! - ys[i]!) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${xs[i + 1]!.toFixed(1)} ${ys[i + 1]!.toFixed(1)}`;
  }
  return d;
}

type Props = {
  stems: AudioStems;
};

export default function StemResonanceVisualizer({ stems }: Props) {
  const filterId = useId().replace(/:/g, '');
  const wrapRef = useRef<HTMLDivElement>(null);
  const wavePathRef = useRef<SVGPathElement>(null);
  const echoPathRef = useRef<SVGPathElement>(null);
  const [size, setSize] = useState({ w: 320, h: 40 });
  const [palettes, setPalettes] = useState<StemConfettiThemePalettes>(() =>
    buildStemConfettiThemePalettes(),
  );

  const { videoRef, state, file } = usePlayerContext();
  const stemsRef = useRef(stems);
  stemsRef.current = stems;
  const useEnvelopesRef = useRef(stemsHaveWaveEnvelopes(stems));
  useEnvelopesRef.current = stemsHaveWaveEnvelopes(stems);

  const liveRef = useRef<BandAmps>(
    Object.fromEntries(STEM_TYPES.map((t) => [t, 0])) as BandAmps,
  );
  const stemIdxRef = useRef(0);
  const stemLastTimeRef = useRef(0);
  const lastBuildRef = useRef(0);
  const playingRef = useRef(false);
  playingRef.current = state.isPlaying && !state.isPaused;

  // Spring state (momentum) — survives re-renders, dies with the component.
  const motionRef = useRef({ amp: 0, ampVel: 0, sharp: 1, drift: 0, driftVel: DRIFT_BASE, lastNow: 0 });

  const sizeRef = useRef(size);
  sizeRef.current = size;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const sync = () => setPalettes(buildStemConfettiThemePalettes());
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    stemIdxRef.current = 0;
    stemLastTimeRef.current = 0;
    for (const t of STEM_TYPES) liveRef.current[t] = 0;
    useEnvelopesRef.current = stemsHaveWaveEnvelopes(stems);
    motionRef.current = { amp: 0, ampVel: 0, sharp: 1, drift: 0, driftVel: DRIFT_BASE, lastNow: 0 };
  }, [stems]);

  useEffect(() => {
    let rafId: number | null = null;
    const xs = new Float32Array(SAMPLE_COUNT + 1);
    const ys = new Float32Array(SAMPLE_COUNT + 1);
    const echoYs = new Float32Array(SAMPLE_COUNT + 1);
    const bands = Object.fromEntries(STEM_TYPES.map((t) => [t, 0])) as BandAmps;

    const tick = (now: number) => {
      rafId = requestAnimationFrame(tick);
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (now - lastBuildRef.current < FRAME_BUDGET_MS) return;
      const m = motionRef.current;
      const dt = Math.min(0.1, m.lastNow > 0 ? (now - m.lastNow) / 1000 : FRAME_BUDGET_MS / 1000);
      lastBuildRef.current = now;
      m.lastNow = now;

      const video = videoRef.current;
      const stemData = stemsRef.current;
      const { w, h } = sizeRef.current;
      const wavePath = wavePathRef.current;
      if (!stemData || !wavePath || w < 8 || h < 8) return;

      const live = liveRef.current;
      for (const t of STEM_TYPES) live[t] = (live[t] ?? 0) * LIVE_DECAY;

      const playhead = video ? video.currentTime : 0;

      // Advance the event pointer: feeds the live fallback amps and the
      // extra punch on top of envelopes.
      if (video && playingRef.current) {
        const evs = stemData.events;
        let idx = stemIdxRef.current;
        if (
          playhead < stemLastTimeRef.current - 0.05 ||
          playhead - stemLastTimeRef.current > 1.5
        ) {
          idx = stemEventIndexAt(evs, playhead);
        }
        while (idx < evs.length && evs[idx]!.t <= playhead) {
          const e = evs[idx]!;
          idx++;
          if (playhead - e.t > 0.18) continue;
          live[e.type] = Math.min(1.2, (live[e.type] ?? 0) + e.s * LIVE_ATTACK);
        }
        stemIdxRef.current = idx;
        stemLastTimeRef.current = playhead;
      }

      // ── Targets from the CURRENT instant only (standing wave, no scroll) ──
      bandAmpsAt(stemData, playhead, live, useEnvelopesRef.current, bands);
      const energy = playingRef.current ? combinedAmplitude(bands) : 0;
      const hardness = playingRef.current ? hardnessAmount(bands) : 0;
      const ampTarget = Math.max(IDLE_AMP, energy);

      // Springs = momentum. Amplitude overshoots on hits and settles;
      // sharpness snaps up with hardness and relaxes slowly; drift speed
      // eases toward its target so the wave glides, never jerks.
      m.ampVel += (ampTarget - m.amp) * AMP_STIFFNESS * dt;
      m.ampVel *= Math.exp(-AMP_DAMPING * dt);
      m.amp = Math.max(0, Math.min(1.2, m.amp + m.ampVel * dt));

      const sharpTarget = 1 + hardness * 2.4;
      const sharpRate = sharpTarget > m.sharp ? SHARP_ATTACK : SHARP_RELEASE;
      m.sharp += (sharpTarget - m.sharp) * Math.min(1, sharpRate * dt);

      const driftTarget = playingRef.current ? DRIFT_BASE + energy * DRIFT_ENERGY : 0.3;
      m.driftVel += (driftTarget - m.driftVel) * Math.min(1, DRIFT_EASE * dt);
      m.drift += m.driftVel * dt;

      // ── Geometry: standing wave, edge-pinned, hardness-shaped peaks ──
      const centerY = h * 0.5;
      const half = h * 0.46;
      const treble = Math.min(1, Math.max(bands.snare ?? 0, bands.hihat ?? 0));

      for (let i = 0; i <= SAMPLE_COUNT; i++) {
        const u = i / SAMPLE_COUNT;
        // Edge taper pins both ends to the centerline (siri-style).
        const window = Math.pow(Math.sin(Math.PI * u), 0.8);
        const main = shapePeak(Math.sin(2 * Math.PI * BASE_CYCLES * u + m.drift), m.sharp);
        // Counter-drifting harmonic adds shimmer when the highs are busy.
        const sparkle = 0.3 * treble * Math.sin(2 * Math.PI * (BASE_CYCLES * 2) * u - m.drift * 1.35);
        const y = m.amp * half * window * (main + sparkle);
        xs[i] = u * w;
        ys[i] = centerY - y;
        echoYs[i] = centerY + y * 0.55;
      }

      wavePath.setAttribute('d', buildSmoothLinePath(xs, ys, SAMPLE_COUNT + 1));
      const echo = echoPathRef.current;
      if (echo) echo.setAttribute('d', buildSmoothLinePath(xs, echoYs, SAMPLE_COUNT + 1));
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [videoRef, stems]);

  const gradientId = `stem-wave-grad-${filterId}`;
  // The video's OWN dominant colors (extracted at upload). Theme palette is
  // only the fallback for files without color data.
  const gradientStops = useMemo(() => {
    const colors = fileAccentColors(file?.colors);
    const list =
      colors.length >= 2
        ? colors
        : ['kick', 'bass', 'other', 'snare', 'hihat'].map(
            (t) => palettes[t as StemType]?.primary ?? 'currentColor',
          );
    const last = Math.max(1, list.length - 1);
    return list.map((color, i) => ({ offset: `${(i / last) * 100}%`, color }));
  }, [file?.colors, palettes]);

  return (
    <div ref={wrapRef} className="relative h-10 w-full pointer-events-none">
      <svg
        className="block h-full w-full"
        viewBox={`0 0 ${size.w} ${size.h}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            {gradientStops.map((s, i) => (
              <stop key={`${i}-${s.color}`} offset={s.offset} stopColor={s.color} />
            ))}
          </linearGradient>
          <filter id={`stem-wave-glow-${filterId}`} x="-20%" y="-60%" width="140%" height="220%">
            <feGaussianBlur stdDeviation="1.1" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Soft mirrored echo below the centerline for depth */}
        <path
          ref={echoPathRef}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={1.1}
          strokeOpacity={0.22}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* The wave */}
        <path
          ref={wavePathRef}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={1.8}
          strokeOpacity={0.95}
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={`url(#stem-wave-glow-${filterId})`}
        />
      </svg>
    </div>
  );
}
