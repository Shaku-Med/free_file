import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { usePlayerContext } from '../../PlayerContext';
import { buildPrimaryVisualizerPalette } from '../../visualizerPalette';
import {
  CONFETTI_SPAWN_FROM_BOTTOM_PX,
  confettiRuntimeConfig,
  type ConfettiAmount,
  type ConfettiSpread,
} from '../../confettiSettings';

/**
 * Subtle bass-kick confetti from the visualizer strip. Only fires on low-end
 * transients (kick), not snare/mids/vocals.
 */

const KICK_COOLDOWN_MS = 200;

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

type PlayerRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const MINI_PLAYER_Z = 2147483646;
const CONFETTI_Z_ABOVE_MINI = MINI_PLAYER_Z + 1;

function bassEnergy(freq: ArrayLike<number>): number {
  let s = 0;
  let c = 0;
  const hi = Math.min(9, freq.length);
  for (let i = 1; i < hi; i++) {
    s += freq[i] ?? 0;
    c++;
  }
  return c ? s / c / 255 : 0;
}

function stackZAbovePlayer(root: HTMLElement): number {
  let maxZ = 0;
  let node: HTMLElement | null = root;
  while (node && node !== document.documentElement) {
    const { position, zIndex } = getComputedStyle(node);
    if (position !== 'static' && zIndex !== 'auto') {
      const z = Number.parseInt(zIndex, 10);
      if (!Number.isNaN(z)) maxZ = Math.max(maxZ, z);
    }
    node = node.parentElement;
  }
  return Math.max(maxZ + 8, 48);
}

function readAnchorRect(anchor: HTMLElement): PlayerRect | null {
  const r = anchor.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function applyWrapLayout(
  wrap: HTMLDivElement,
  rect: PlayerRect,
  rt: ReturnType<typeof confettiRuntimeConfig>,
  stackZ: number,
) {
  wrap.style.left = `${rect.left - rt.spillSide}px`;
  wrap.style.top = `${rect.top - rt.spillTop}px`;
  wrap.style.width = `${rect.width + rt.spillSide * 2}px`;
  wrap.style.height = `${rect.height + rt.spillTop + rt.spillBottom}px`;
  wrap.style.zIndex = String(stackZ);
}

function spawnOffsetFromBottom(rectHeight: number): number {
  return Math.min(CONFETTI_SPAWN_FROM_BOTTOM_PX, Math.max(18, rectHeight * 0.12));
}

type BassConfettiProps = {
  analyser: AnalyserNode | null;
  anchorRef?: RefObject<HTMLElement | null>;
};

export default function BassConfetti({ analyser, anchorRef: anchorRefProp }: BassConfettiProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stackZRef = useRef(48);
  const analyserRef = useRef(analyser);
  analyserRef.current = analyser;

  const amountRef = useRef<ConfettiAmount>('normal');
  const spreadRef = useRef<ConfettiSpread>('normal');

  const {
    state,
    containerRef,
    visualizerConfetti,
    visualizerConfettiAmount,
    visualizerConfettiSpread,
  } = usePlayerContext();

  amountRef.current = visualizerConfettiAmount;
  spreadRef.current = visualizerConfettiSpread;

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

  const [portalReady, setPortalReady] = useState(false);

  useEffect(() => {
    if (!visualizerConfetti) {
      setPortalReady(false);
      return;
    }
    setPortalReady(true);
    return () => setPortalReady(false);
  }, [visualizerConfetti]);

  useEffect(() => {
    if (!portalReady || !visualizerConfetti) return;
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
    let rafId: number | null = null;
    let bassEnv = 0;
    let lastKick = 0;

    const spawnKickBurst = (
      rect: PlayerRect,
      rt: ReturnType<typeof confettiRuntimeConfig>,
    ) => {
      const count = Math.max(2, Math.round((3 + Math.floor(Math.random() * 3)) * rt.countMul));
      const spawnLineY = rt.spillTop + rect.height - spawnOffsetFromBottom(rect.height);
      const playerW = rect.width;

      for (let i = 0; i < count && particles.length < rt.maxParticles; i++) {
        const x = rt.spillSide + playerW * (0.14 + Math.random() * 0.72);
        particles.push({
          x,
          y: spawnLineY + (Math.random() - 0.5) * 2,
          vx: (Math.random() - 0.5) * 2.8,
          vy: -(0.35 + Math.random() * 0.85),
          size: 2.5 + Math.random() * 2.5,
          rot: Math.random() * Math.PI,
          vrot: (Math.random() - 0.5) * 0.35,
          color: palette[Math.floor(Math.random() * palette.length)] ?? 'rgb(99, 102, 241)',
          life: 0,
          maxLife: 36 + Math.random() * 28,
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

      const rt = confettiRuntimeConfig(amountRef.current, spreadRef.current);

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
        an.getByteFrequencyData(freq as Parameters<AnalyserNode['getByteFrequencyData']>[0]);

        const bass = bassEnergy(freq);
        bassEnv = bassEnv * 0.94 + bass * 0.06;
        const now = performance.now();
        const cooldown = KICK_COOLDOWN_MS * rt.cooldownMul;

        if (bass > 0.38 && bass - bassEnv > 0.09 && now - lastKick > cooldown) {
          lastKick = now;
          spawnKickBurst(rect, rt);
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
    if (initial) resizeCanvas(initial, confettiRuntimeConfig(amountRef.current, spreadRef.current));
    rafId = requestAnimationFrame(tick);

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      mo?.disconnect();
      particles.length = 0;
      freq = null;
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [portalReady, visualizerConfetti]);

  if (!portalReady || !visualizerConfetti || typeof document === 'undefined') return null;

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
