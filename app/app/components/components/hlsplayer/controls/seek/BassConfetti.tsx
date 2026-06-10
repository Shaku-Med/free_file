import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePlayerContext } from '../../PlayerContext';
import {
  buildInstrumentConfettiPalettes,
  type InstrumentConfettiPalettes,
} from '../../visualizerPalette';

/**
 * Instrument-reactive confetti for the audio visualizer:
 * - Bass / kick → left, darker primary shades
 * - Snare / percussion → right, lighter shades
 * - Other instruments → center, mid shades (vocal band subtracted)
 *
 * Rendered in a fixed portal aligned to the player so particles can spill
 * outside the player's overflow-hidden bounds.
 */

const SPILL_TOP = 180;
const SPILL_SIDE = 56;
const SPILL_BOTTOM = 72;
const MAX_PARTICLES = 240;

const KICK_COOLDOWN_MS = 130;
const SNARE_COOLDOWN_MS = 95;
const MID_COOLDOWN_MS = 150;

type BandKind = 'bass' | 'mid' | 'percussion';

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vrot: number;
  color: string;
  life: number;
  maxLife: number;
};

type BandDetector = {
  env: number;
  prev: number;
  lastHit: number;
};

type PlayerBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function avgFreq(freq: ArrayLike<number>, lo: number, hi: number): number {
  let s = 0;
  let c = 0;
  const a = Math.max(0, lo);
  const b = Math.min(freq.length, hi);
  for (let i = a; i < b; i++) {
    s += freq[i] ?? 0;
    c++;
  }
  return c ? s / c / 255 : 0;
}

/** Slow baseline with fast release so transients stay detectable on loud tracks. */
function updateEnv(env: number, energy: number): number {
  const coeff = energy > env ? 0.18 : 0.06;
  return env * (1 - coeff) + energy * coeff;
}

function detectTransient(
  det: BandDetector,
  energy: number,
  now: number,
  cooldownMs: number,
  minEnergy: number,
  fluxMargin: number,
): boolean {
  const onset = Math.max(0, energy - det.prev);
  det.env = updateEnv(det.env, energy);
  const flux = energy - det.env;
  det.prev = energy;

  if (now - det.lastHit < cooldownMs) return false;
  if (energy < minEnergy) return false;
  if (flux < fluxMargin && onset < fluxMargin * 0.55) return false;

  det.lastHit = now;
  return true;
}

function pickColor(palettes: InstrumentConfettiPalettes, kind: BandKind): string {
  const list =
    kind === 'bass' ? palettes.bass : kind === 'mid' ? palettes.mid : palettes.percussion;
  return list[Math.floor(Math.random() * list.length)] ?? 'rgb(99, 102, 241)';
}

function applyCanvasLayout(canvas: HTMLCanvasElement, bounds: PlayerBounds) {
  canvas.style.left = `${bounds.left - SPILL_SIDE}px`;
  canvas.style.top = `${bounds.top - SPILL_TOP}px`;
  canvas.style.width = `${bounds.width + SPILL_SIDE * 2}px`;
  canvas.style.height = `${bounds.height + SPILL_TOP + SPILL_BOTTOM}px`;
}

export default function BassConfetti({ analyser }: { analyser: AnalyserNode | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef(analyser);
  analyserRef.current = analyser;

  const boundsRef = useRef<PlayerBounds | null>(null);
  const { state, containerRef } = usePlayerContext();
  const playingRef = useRef(false);
  playingRef.current = state.isPlaying && !state.isPaused;

  const [portalReady, setPortalReady] = useState(false);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) {
      boundsRef.current = null;
      setPortalReady(false);
      return;
    }

    const syncBounds = () => {
      const r = root.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      boundsRef.current = {
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
      };
      const canvas = canvasRef.current;
      if (canvas) applyCanvasLayout(canvas, boundsRef.current);
      setPortalReady((ready) => ready || true);
    };

    syncBounds();
    const ro = new ResizeObserver(syncBounds);
    ro.observe(root);
    window.addEventListener('scroll', syncBounds, true);
    window.addEventListener('resize', syncBounds);

    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', syncBounds, true);
      window.removeEventListener('resize', syncBounds);
      boundsRef.current = null;
      setPortalReady(false);
    };
  }, [containerRef]);

  useEffect(() => {
    if (!portalReady) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let palettes = buildInstrumentConfettiPalettes();
    const syncPalette = () => {
      palettes = buildInstrumentConfettiPalettes();
    };
    let mo: MutationObserver | null = null;
    if (typeof document !== 'undefined') {
      mo = new MutationObserver(syncPalette);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }

    let canvasW = 0;
    let canvasH = 0;
    let dpr = 1;

    const resizeCanvas = (bounds: PlayerBounds) => {
      dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
      canvasW = bounds.width + SPILL_SIDE * 2;
      canvasH = bounds.height + SPILL_TOP + SPILL_BOTTOM;
      canvas.width = Math.floor(canvasW * dpr);
      canvas.height = Math.floor(canvasH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      applyCanvasLayout(canvas, bounds);
    };

    const particles: Particle[] = [];
    let freq: Uint8Array | null = null;
    let rafId: number | null = null;

    const bassDet: BandDetector = { env: 0, prev: 0, lastHit: -9999 };
    const midDet: BandDetector = { env: 0, prev: 0, lastHit: -9999 };
    const percDet: BandDetector = { env: 0, prev: 0, lastHit: -9999 };

    const spawnBurst = (
      bounds: PlayerBounds,
      kind: BandKind,
      count: number,
      xMin: number,
      xMax: number,
      vxBias: number,
    ) => {
      const spawnLineY = SPILL_TOP + bounds.height - 10;
      const playerW = bounds.width;
      for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
        const t = xMin + Math.random() * (xMax - xMin);
        const x = SPILL_SIDE + playerW * t;
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.35 + vxBias;
        const speed = 3.5 + Math.random() * 5.5;
        particles.push({
          x,
          y: spawnLineY + (Math.random() - 0.5) * 6,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.5,
          size: 3 + Math.random() * 4.5,
          rot: Math.random() * Math.PI,
          vrot: (Math.random() - 0.5) * 0.45,
          color: pickColor(palettes, kind),
          life: 0,
          maxLife: 52 + Math.random() * 48,
        });
      }
    };

    const analyzeBands = (fd: Uint8Array) => {
      const bass = avgFreq(fd, 1, 9);
      const vocal = avgFreq(fd, 14, 42);
      const lowMid = avgFreq(fd, 9, 14);
      const upperMid = avgFreq(fd, 42, 72);
      const midRaw = lowMid * 0.5 + upperMid * 0.5;
      const mid = Math.max(0, midRaw - vocal * 0.82);
      const snare = avgFreq(fd, 72, 130);
      const hats = avgFreq(fd, 130, 240);
      const perc = snare * 0.62 + hats * 0.38;
      return { bass, mid, perc };
    };

    const tick = () => {
      rafId = requestAnimationFrame(tick);

      const bounds = boundsRef.current;
      if (!bounds) return;

      const nextW = bounds.width + SPILL_SIDE * 2;
      const nextH = bounds.height + SPILL_TOP + SPILL_BOTTOM;
      if (nextW !== canvasW || nextH !== canvasH) resizeCanvas(bounds);

      const hidden = typeof document !== 'undefined' && document.visibilityState !== 'visible';

      if (!hidden) {
        ctx.clearRect(0, 0, canvasW, canvasH);
      }

      const an = analyserRef.current;
      if (an && playingRef.current && !hidden) {
        const len = an.frequencyBinCount;
        if (!freq || freq.length !== len) freq = new Uint8Array(len);
        an.getByteFrequencyData(freq as Parameters<AnalyserNode['getByteFrequencyData']>[0]);

        const { bass, mid, perc } = analyzeBands(freq);
        const now = performance.now();

        if (detectTransient(bassDet, bass, now, KICK_COOLDOWN_MS, 0.22, 0.055)) {
          spawnBurst(bounds, 'bass', 8 + Math.floor(Math.random() * 7), 0.04, 0.28, -0.12);
        }
        if (detectTransient(percDet, perc, now, SNARE_COOLDOWN_MS, 0.18, 0.045)) {
          spawnBurst(bounds, 'percussion', 6 + Math.floor(Math.random() * 6), 0.72, 0.96, 0.12);
        }
        if (detectTransient(midDet, mid, now, MID_COOLDOWN_MS, 0.16, 0.04)) {
          spawnBurst(bounds, 'mid', 5 + Math.floor(Math.random() * 5), 0.34, 0.66, 0);
        }
      }

      let write = 0;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]!;
        p.life++;
        if (p.life >= p.maxLife) continue;

        p.vy += 0.17;
        p.vx *= 0.992;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vrot;

        if (!hidden) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.globalAlpha = Math.max(0, 1 - p.life / p.maxLife);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.62);
          ctx.restore();
        }

        particles[write++] = p;
      }
      particles.length = write;
    };

    const initial = boundsRef.current;
    if (initial) resizeCanvas(initial);
    rafId = requestAnimationFrame(tick);

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      mo?.disconnect();
      particles.length = 0;
      freq = null;
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [portalReady]);

  if (!portalReady || typeof document === 'undefined') return null;

  return createPortal(
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed block"
      style={{ zIndex: 40 }}
    />,
    document.body,
  );
}
