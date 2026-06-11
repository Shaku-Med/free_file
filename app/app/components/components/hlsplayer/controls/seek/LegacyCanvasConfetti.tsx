import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { usePlayerContext } from '../../PlayerContext';
import { buildPrimaryVisualizerPalette } from '../../visualizerPalette';
import { CONFETTI_SPAWN_FROM_BOTTOM_PX, confettiRuntimeConfig } from '../../confettiSettings';
import {
  applyWrapLayout,
  CONFETTI_Z_ABOVE_MINI,
  readAnchorRect,
  stackZAbovePlayer,
  type PlayerRect,
} from './confettiLayout';

const KICK_COOLDOWN_MS = 180;

function bandEnergy(
  freq: ArrayLike<number>,
  binStart: number,
  binEnd: number,
  emphasisLow = 1,
): number {
  const start = Math.max(1, binStart);
  const end = Math.min(freq.length - 1, binEnd);
  if (end < start) return 0;
  let weighted = 0;
  let wSum = 0;
  const span = end - start + 1;
  for (let i = start; i <= end; i++) {
    const t = span <= 1 ? 0 : (i - start) / (span - 1);
    const w = 1 + (emphasisLow - 1) * (1 - t);
    weighted += (freq[i] ?? 0) * w;
    wSum += w;
  }
  return wSum ? weighted / wSum / 255 : 0;
}

function kickBodyEnergy(freq: ArrayLike<number>): number {
  return bandEnergy(freq, 1, Math.min(24, freq.length - 1), 1.35);
}

function kickPunchEnergy(freq: ArrayLike<number>): number {
  return bandEnergy(freq, 6, Math.min(40, freq.length - 1), 0.85);
}

function waveformRms(time: ArrayLike<number>): number {
  if (!time.length) return 0;
  let sum = 0;
  for (let i = 0; i < time.length; i++) {
    const v = ((time[i] ?? 128) - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / time.length);
}

function spectralEnergy(freq: ArrayLike<number>): number {
  let s = 0;
  const start = 1;
  const end = Math.min(freq.length, Math.floor(freq.length * 0.72));
  if (end <= start) return 0;
  for (let i = start; i < end; i++) s += freq[i] ?? 0;
  return s / ((end - start) * 255);
}

function mixTension(freq: ArrayLike<number>, kickBody: number, prev: number): number {
  const energy = spectralEnergy(freq);
  const raw = Math.min(1, energy * 0.55 + kickBody * 0.45);
  return prev * 0.9 + raw * 0.1;
}

type KickStrike = { score: number; tension: number };

function detectKickStrike(
  body: number,
  punch: number,
  wave: number,
  bodyEnv: number,
  punchEnv: number,
  waveEnv: number,
  mixTensionVal: number,
): KickStrike | null {
  const bodyStrike = body - bodyEnv;
  const punchStrike = punch - punchEnv;
  const waveStrike = wave - waveEnv;
  const bandStrike = Math.max(bodyStrike, punchStrike);

  const bodyFloor = 0.14 + mixTensionVal * 0.06;
  const punchFloor = 0.18 + mixTensionVal * 0.08;
  const bandTransient =
    bandStrike > 0.055 &&
    (body > bodyFloor || punch > punchFloor) &&
    (bodyStrike > 0.045 || punchStrike > 0.04);

  const waveFloor = 0.028 + mixTensionVal * 0.012;
  const waveTransient =
    waveStrike > 0.018 && wave > waveFloor && bandStrike > 0.028;

  if (!bandTransient && !waveTransient) return null;

  const normBand = Math.min(1, bandStrike / 0.14);
  const normWave = Math.min(1, waveStrike / 0.055);
  const score = Math.max(normBand, normWave * 0.92);
  const tension = Math.min(
    1,
    mixTensionVal * 0.4 + score * 0.45 + Math.min(1, bodyStrike / 0.16) * 0.15,
  );
  return { score, tension };
}

function spawnOffsetFromBottom(rectHeight: number): number {
  return Math.min(CONFETTI_SPAWN_FROM_BOTTOM_PX, Math.max(18, rectHeight * 0.12));
}

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

type LegacyCanvasConfettiProps = {
  analyser: AnalyserNode | null;
  anchorRef?: RefObject<HTMLElement | null>;
};

/** Live-analyser confetti (canvas) for uploads without audio_stems.json. */
export default function LegacyCanvasConfetti({ analyser, anchorRef: anchorRefProp }: LegacyCanvasConfettiProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stackZRef = useRef(48);
  const analyserRef = useRef(analyser);
  analyserRef.current = analyser;

  const { state, containerRef } = usePlayerContext();

  const anchorRefPropRef = useRef(anchorRefProp);
  anchorRefPropRef.current = anchorRefProp;
  const isMiniAnchorRef = useRef(false);

  const resolveAnchor = (): HTMLElement | null => {
    const anchorProp = anchorRefPropRef.current;
    if (anchorProp) {
      isMiniAnchorRef.current = true;
      return anchorProp.current;
    }
    isMiniAnchorRef.current = false;
    return containerRef.current;
  };

  const playingRef = useRef(false);
  playingRef.current = state.isPlaying && !state.isPaused;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let palette = buildPrimaryVisualizerPalette();
    const syncPalette = () => {
      palette = buildPrimaryVisualizerPalette();
    };
    let mo: MutationObserver | null = null;
    if (typeof document !== 'undefined') {
      mo = new MutationObserver(syncPalette);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }

    let canvasW = 0;
    let canvasH = 0;
    let tensionEnv = 0.25;

    const resizeCanvas = (rect: PlayerRect, rt: ReturnType<typeof confettiRuntimeConfig>) => {
      const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
      canvasW = rect.width + rt.spillSide * 2;
      canvasH = rect.height + rt.spillTop + rt.spillBottom;
      canvas.width = Math.floor(canvasW * dpr);
      canvas.height = Math.floor(canvasH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const particles: Particle[] = [];
    let freq: Uint8Array | null = null;
    let time: Uint8Array | null = null;
    let rafId: number | null = null;
    let bodyEnv = 0;
    let punchEnv = 0;
    let waveEnv = 0;
    let lastKick = 0;

    const spawnKickBurst = (
      rect: PlayerRect,
      rt: ReturnType<typeof confettiRuntimeConfig>,
      kickTension: number,
    ) => {
      const count = Math.max(
        2,
        Math.round((2 + Math.floor(Math.random() * 4)) * rt.countMul * (0.55 + kickTension * 0.75)),
      );
      const spawnLineY = rt.spillTop + rect.height - spawnOffsetFromBottom(rect.height);
      const playerW = rect.width;
      const sizeBoost = 0.85 + kickTension * 0.35;

      for (let i = 0; i < count && particles.length < rt.maxParticles; i++) {
        const x = rt.spillSide + playerW * (0.14 + Math.random() * 0.72);
        particles.push({
          x,
          y: spawnLineY + (Math.random() - 0.5) * 2,
          vx: (Math.random() - 0.5) * (2.2 + kickTension * 1.4),
          vy: -(0.3 + Math.random() * (0.55 + kickTension * 0.45)),
          size: (2.2 + Math.random() * 2.2) * sizeBoost,
          rot: Math.random() * Math.PI,
          vrot: (Math.random() - 0.5) * 0.35,
          color: palette[Math.floor(Math.random() * palette.length)] ?? 'rgb(99, 102, 241)',
          life: 0,
          maxLife: 34 + Math.random() * (22 + kickTension * 18),
        });
      }
    };

    const tick = () => {
      rafId = requestAnimationFrame(tick);

      const anchor = resolveAnchor();
      if (!anchor) return;

      const rect = readAnchorRect(anchor);
      if (!rect) return;

      stackZRef.current = isMiniAnchorRef.current
        ? CONFETTI_Z_ABOVE_MINI
        : stackZAbovePlayer(anchor);

      const rt = confettiRuntimeConfig(tensionEnv);

      const nextW = rect.width + rt.spillSide * 2;
      const nextH = rect.height + rt.spillTop + rt.spillBottom;
      if (nextW !== canvasW || nextH !== canvasH) resizeCanvas(rect, rt);

      const wrap = wrapRef.current;
      if (wrap) applyWrapLayout(wrap, rect, rt, stackZRef.current);

      const hidden = typeof document !== 'undefined' && document.visibilityState !== 'visible';
      if (!hidden) ctx.clearRect(0, 0, canvasW, canvasH);

      const an = analyserRef.current;
      if (an && playingRef.current && !hidden) {
        const len = an.frequencyBinCount;
        if (!freq || freq.length !== len) freq = new Uint8Array(len);
        if (!time || time.length !== an.fftSize) time = new Uint8Array(an.fftSize);
        an.getByteFrequencyData(freq as Parameters<AnalyserNode['getByteFrequencyData']>[0]);
        an.getByteTimeDomainData(time as Parameters<AnalyserNode['getByteTimeDomainData']>[0]);

        const body = kickBodyEnergy(freq);
        const punch = kickPunchEnergy(freq);
        const wave = waveformRms(time);

        bodyEnv = bodyEnv * 0.93 + body * 0.07;
        punchEnv = punchEnv * 0.91 + punch * 0.09;
        waveEnv = waveEnv * 0.88 + wave * 0.12;
        tensionEnv = mixTension(freq, body, tensionEnv);

        const now = performance.now();
        const cooldown = KICK_COOLDOWN_MS * rt.cooldownMul;
        const strike = detectKickStrike(
          body,
          punch,
          wave,
          bodyEnv,
          punchEnv,
          waveEnv,
          tensionEnv,
        );

        if (strike && strike.score > 0.42 && now - lastKick > cooldown) {
          lastKick = now;
          spawnKickBurst(rect, confettiRuntimeConfig(strike.tension), strike.tension);
        }
      }

      let write = 0;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]!;
        p.life++;
        if (p.life >= p.maxLife) continue;

        p.vy += 0.28;
        p.vx *= 0.992;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vrot;

        if (!hidden) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.globalAlpha = Math.max(0, 0.72 * (1 - p.life / p.maxLife));
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.62);
          ctx.restore();
        }
        particles[write++] = p;
      }
      particles.length = write;
    };

    const initialAnchor = resolveAnchor();
    const initial = initialAnchor ? readAnchorRect(initialAnchor) : null;
    if (initial) resizeCanvas(initial, confettiRuntimeConfig(tensionEnv));
    rafId = requestAnimationFrame(tick);

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      mo?.disconnect();
      particles.length = 0;
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [containerRef]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={wrapRef}
      aria-hidden
      className="pointer-events-none fixed block"
      style={{ zIndex: stackZRef.current }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>,
    document.body,
  );
}
