import { useEffect, useMemo, useRef } from 'react';
import { usePlayerContext } from '../PlayerContext';
import { stemEventIndexAt } from '../audioStems';
import { fileAccentColors } from '../visualizerPalette';

/**
 * Beat-reactive glow LIGHT behind the player (confetti's replacement).
 *
 * Same recipe as AmbientBackground: a tiny canvas painted once with soft
 * color blobs from the FILE's own dominant colors, stretched way past the
 * player (150%) so bilinear upscaling melts everything into a smooth glow,
 * and a radial mask kills any sharp edges. Bass/kick hits shove a spring
 * that brightens the light and breathes it bigger; the tension envelope
 * keeps it hot through a driving section and cools it on breakdowns.
 *
 * Per-frame cost is two style writes (opacity + scale) — the canvas itself
 * is painted only when the file's colors change.
 */

const STIFFNESS = 150;
const DAMPING = 9;
const KICK_IMPULSE = 1.5;
const BASS_IMPULSE = 1.0;
const SNARE_IMPULSE = 0.35;
const TENSION_GAIN = 0.3;
const TENSION_DECAY_PER_S = 0.5;
const FRESH_WINDOW_S = 0.2;
const SEEK_RESYNC_S = 1.5;

/** Tiny paint surface — upscaling does the blur for free, like ambient. */
const PAINT_SIZE = 32;

const SOFT_MASK =
  'radial-gradient(ellipse 72% 72% at 50% 50%, black 18%, rgba(0,0,0,0.45) 55%, transparent 88%)';

/** Blob anchors (canvas-relative): corners + center so colors mix mid-canvas. */
const BLOB_ANCHORS = [
  { x: 0.2, y: 0.2 },
  { x: 0.8, y: 0.2 },
  { x: 0.8, y: 0.8 },
  { x: 0.2, y: 0.8 },
  { x: 0.5, y: 0.5 },
  { x: 0.5, y: 0.1 },
] as const;

export default function StemGlowLight() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { videoRef, audioStems, visualizerConfetti, state, file } = usePlayerContext();

  const playingRef = useRef(false);
  playingRef.current = state.isPlaying && !state.isPaused;
  const stemsRef = useRef(audioStems);
  stemsRef.current = audioStems;

  const enabled = visualizerConfetti && audioStems != null;

  const colors = useMemo(() => {
    const c = fileAccentColors(file?.colors);
    return c.length >= 2 ? c : ['#6366f1', '#8b5cf6'];
  }, [file?.colors]);
  const colorKey = colors.join(',');

  // Paint once per color set: soft additive blobs that the upscale blends.
  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = PAINT_SIZE;
    canvas.height = PAINT_SIZE;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    ctx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    ctx.globalCompositeOperation = 'lighter';
    colors.forEach((color, i) => {
      const anchor = BLOB_ANCHORS[i % BLOB_ANCHORS.length]!;
      const cx = anchor.x * PAINT_SIZE;
      const cy = anchor.y * PAINT_SIZE;
      const r = PAINT_SIZE * 0.62;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    });
    ctx.globalCompositeOperation = 'source-over';

    return () => {
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [enabled, colorKey, colors]);

  // Beat drive: spring + tension envelope writing opacity/scale only.
  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let rafId: number | null = null;
    let disp = 0;
    let vel = 0;
    let tension = 0.2;
    let lastNow = 0;
    let idx = 0;
    let lastTime = 0;

    const tick = (now: number) => {
      rafId = requestAnimationFrame(tick);
      const dt = Math.min(0.05, lastNow > 0 ? (now - lastNow) / 1000 : 1 / 60);
      lastNow = now;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

      const video = videoRef.current;
      const stems = stemsRef.current;
      if (!video || !stems) return;

      tension = Math.max(0, tension - TENSION_DECAY_PER_S * dt);

      if (playingRef.current) {
        const t = video.currentTime;
        const evs = stems.events;
        if (t < lastTime - 0.05 || t - lastTime > SEEK_RESYNC_S) {
          idx = stemEventIndexAt(evs, t);
        }
        while (idx < evs.length && evs[idx]!.t <= t) {
          const e = evs[idx]!;
          idx++;
          if (t - e.t > FRESH_WINDOW_S) continue;
          if (e.type === 'kick') vel += e.s * KICK_IMPULSE;
          else if (e.type === 'bass') vel += e.s * BASS_IMPULSE;
          else if (e.type === 'snare') vel += e.s * SNARE_IMPULSE;
          else continue;
          tension = Math.min(1.5, tension + TENSION_GAIN * e.s);
        }
        lastTime = t;
      }

      vel += -disp * STIFFNESS * dt;
      vel *= Math.exp(-DAMPING * dt);
      disp = Math.max(0, Math.min(1.2, disp + vel * dt));

      // Bright actual-light levels: warm idle while playing, hits flare hard.
      const base = playingRef.current ? 0.34 + Math.min(0.3, tension * 0.28) : 0.12;
      const intensity = Math.min(1, base + disp * 0.75);
      const scale = 1 + disp * 0.09;

      canvas.style.opacity = intensity.toFixed(3);
      canvas.style.transform = `scale(${scale.toFixed(4)})`;
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [enabled, videoRef, audioStems]);

  if (!enabled) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-0" aria-hidden>
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: '-25%',
          width: '150%',
          height: '150%',
          opacity: 0.12,
          transformOrigin: '50% 50%',
          willChange: 'opacity, transform',
          filter: 'saturate(1.35)',
          maskImage: SOFT_MASK,
          WebkitMaskImage: SOFT_MASK,
        }}
      />
    </div>
  );
}
