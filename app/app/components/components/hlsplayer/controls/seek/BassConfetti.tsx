import { useEffect, useRef } from 'react';
import { usePlayerContext } from '../../PlayerContext';
import { buildPrimaryVisualizerPalette } from '../../visualizerPalette';

/**
 * Pops confetti out of the visualizer strip on each bass kick (a sharp low-end
 * transient, not a sustained bass line)  a little "the player is vibing too".
 * Reuses the analyser node owned by the persistent visualizer; never taps the
 * video a second time.
 */

const CANVAS_HEIGHT = 150;
const MAX_PARTICLES = 140;
/** Refractory window so a steady bass groove doesn't spray every frame. */
const KICK_COOLDOWN_MS = 150;

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

export default function BassConfetti({ analyser }: { analyser: AnalyserNode | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef(analyser);
  analyserRef.current = analyser;

  const { state } = usePlayerContext();
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

    const resize = () => {
      const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w < 1 || h < 1) return;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const particles: Particle[] = [];
    let freq: Uint8Array | null = null;
    let bassEnv = 0;
    let lastKick = 0;
    let rafId: number | null = null;

    const bassEnergy = (fd: Uint8Array): number => {
      // Bins ~1..7 cover sub-bass / kick territory at fftSize 2048.
      let s = 0;
      let c = 0;
      const hi = Math.min(8, fd.length);
      for (let i = 1; i < hi; i++) {
        s += fd[i]!;
        c++;
      }
      return c ? s / c / 255 : 0;
    };

    const spawn = (w: number, h: number) => {
      const count = 10 + Math.floor(Math.random() * 9);
      for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.25; // mostly upward
        const speed = 4 + Math.random() * 5;
        particles.push({
          x: w * (0.12 + Math.random() * 0.76),
          y: h - 2,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 3 + Math.random() * 4,
          rot: Math.random() * Math.PI,
          vrot: (Math.random() - 0.5) * 0.4,
          color: palette[Math.floor(Math.random() * palette.length)] ?? '#22c55e',
          life: 0,
          maxLife: 48 + Math.random() * 42,
        });
      }
    };

    const tick = () => {
      rafId = requestAnimationFrame(tick);
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w < 1 || h < 1) return;
      ctx.clearRect(0, 0, w, h);

      const an = analyserRef.current;
      if (an && playingRef.current) {
        const len = an.frequencyBinCount;
        if (!freq || freq.length !== len) freq = new Uint8Array(len);
        an.getByteFrequencyData(freq as Parameters<AnalyserNode['getByteFrequencyData']>[0]);
        const bass = bassEnergy(freq);
        // Slow envelope = adaptive baseline that lags well behind transients, so a
        // kick stands out as a jump *above* it. Use an ADDITIVE margin (not a
        // ratio): on loud tracks the baseline already sits high, so a
        // multiplicative threshold like `bass > bassEnv * 1.45` can never be met
        // (it'd need >1.0) and the confetti would never fire.
        bassEnv = bassEnv * 0.94 + bass * 0.06;
        const now = performance.now();
        if (bass > 0.34 && bass - bassEnv > 0.07 && now - lastKick > KICK_COOLDOWN_MS) {
          lastKick = now;
          spawn(w, h);
        }
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]!;
        p.life++;
        if (p.life >= p.maxLife) {
          particles.splice(i, 1);
          continue;
        }
        p.vy += 0.16; // gravity
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vrot;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, 1 - p.life / p.maxLife);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      ro.disconnect();
      mo?.disconnect();
      particles.length = 0;
      freq = null;
      canvas.width = 0;
      canvas.height = 0;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute bottom-0 left-0 right-0 block"
      style={{ height: CANVAS_HEIGHT }}
    />
  );
}
