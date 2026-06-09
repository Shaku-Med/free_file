import { useEffect, useRef } from 'react';
import { usePlayerContext } from '../../PlayerContext';
import type { AudioVisualizerStyle } from '../../audioVisualizerStyles';
import {
  applyAlphaToCssColor,
  buildPrimaryVisualizerPalette,
  paletteColorAtIndex,
} from '../../visualizerPalette';

type Props = {
  analyser: AnalyserNode | null;
  active: boolean;
  variant: AudioVisualizerStyle;
};

/** Spring chase speed  bars snap up fast */
const ATTACK = 0.55;
/** Decay speed  bars fall with bounce */
const DECAY = 0.12;
/** Velocity retained per frame  gives bounce overshoot */
const VELOCITY_DAMPING = 0.72;
/** How much velocity overshoots the target */
const OVERSHOOT = 1.6;

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

/**
 * Map a 0..1 frequency-bin reading to a 0..1 bar height.
 *
 * `raw` comes from getByteFrequencyData over the analyser's -90..-20 dB window.
 * The old `Math.min(1, raw * 5)` pinned almost everything to 1.0 (bars stuck at
 * full height with only the tips moving). Instead: drop a small noise floor and
 * expand with a gentle gamma + modest gain so bars actually travel their range.
 */
function visEnergy(raw: number): number {
  const FLOOR = 0.12;
  const x = (raw - FLOOR) / (1 - FLOOR);
  if (x <= 0) return 0;
  return Math.min(1, Math.pow(x, 0.78) * 1.3);
}

/**
 * Treble bins carry far less energy than bass, so without a lift only the
 * left (bass) bars move. Ramp a gain from 1.0 at the low end up to ~2.1 at the
 * high end so the whole spectrum dances.
 */
function freqTilt(i: number, count: number): number {
  if (count <= 1) return 1;
  return 1 + (i / (count - 1)) * 1.1;
}

export default function SeekBarSpectrum({ analyser, active, variant }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef(analyser);
  analyserRef.current = analyser;
  const variantRef = useRef(variant);
  variantRef.current = variant;

  const ampRef = useRef<Float32Array | null>(null);
  const velRef = useRef<Float32Array | null>(null);
  const freqRef = useRef<Uint8Array | null>(null);
  const playingRef = useRef(false);
  const paletteRef = useRef<string[]>([]);

  const { state, file } = usePlayerContext();
  playingRef.current = state.isPlaying && !state.isPaused;
  const mediaKey = file?.id ?? '';

  useEffect(() => {
    const syncPalette = () => {
      paletteRef.current = buildPrimaryVisualizerPalette();
    };
    syncPalette();
    if (typeof document === 'undefined') return;
    const mo = new MutationObserver(syncPalette);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !active) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w < 1 || h < 1) return;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    /** Spring-chase a target: fast attack, slow decay with velocity bounce */
    const springChase = (
      current: Float32Array,
      velocity: Float32Array,
      index: number,
      target: number,
    ) => {
      const cur = current[index]!;
      const vel = velocity[index]!;
      const diff = target - cur;

      if (diff > 0) {
        current[index] = cur + diff * ATTACK + vel * OVERSHOOT;
        velocity[index] = diff * 0.4;
      } else {
        const newVel = vel * VELOCITY_DAMPING + diff * DECAY;
        current[index] = cur + newVel;
        velocity[index] = newVel;
      }
      current[index] = Math.max(0, Math.min(1.15, current[index]!));
    };

    const drawBar = (
      x: number,
      y: number,
      bw: number,
      bh: number,
      color: string,
      amp: number,
      r: number,
    ) => {
      const a = 0.45 + amp * 0.55;
      const grad = ctx.createLinearGradient(x, y + bh, x, y);
      grad.addColorStop(0, applyAlphaToCssColor(color, a * 0.4));
      grad.addColorStop(1, applyAlphaToCssColor(color, a));
      ctx.fillStyle = grad;
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(x, y, bw, bh, r);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, bw, bh);
      }
    };

    const drawCBar = (
      x: number,
      cy: number,
      bw: number,
      half: number,
      color: string,
      amp: number,
      r: number,
    ) => {
      const a = 0.45 + amp * 0.55;
      const grad = ctx.createLinearGradient(x, cy - half, x, cy + half);
      grad.addColorStop(0, applyAlphaToCssColor(color, a * 0.6));
      grad.addColorStop(0.5, applyAlphaToCssColor(color, a));
      grad.addColorStop(1, applyAlphaToCssColor(color, a * 0.6));
      ctx.fillStyle = grad;
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(x, cy - half, bw, half * 2, r);
        ctx.fill();
      } else {
        ctx.fillRect(x, cy - half, bw, half * 2);
      }
    };

    let rafId: number | null = null;

    const tick = () => {
      rafId = requestAnimationFrame(tick);
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w < 1 || h < 1) return;

      const an = analyserRef.current;
      const playing = playingRef.current;
      const v = variantRef.current;

      if (!an) {
        ctx.clearRect(0, 0, w, h);
        return;
      }

      let palette = paletteRef.current;
      if (palette.length === 0) {
        palette = buildPrimaryVisualizerPalette();
        paletteRef.current = palette;
      }

      const fdLen = an.frequencyBinCount;
      if (!freqRef.current || freqRef.current.length !== fdLen) {
        freqRef.current = new Uint8Array(fdLen);
      }
      const fd = freqRef.current;
      an.getByteFrequencyData(fd as Parameters<AnalyserNode['getByteFrequencyData']>[0]);

      ctx.clearRect(0, 0, w, h);

      // Auto-scale bar count. Bigger/chunkier bars so they read at a glance.
      const autoBarCount = (minBars: number, maxBars: number, pxPerBar: number) =>
        Math.max(minBars, Math.min(maxBars, Math.floor(w / pxPerBar)));

      // ── Spectrum bars ── chunky bars, aggressive bounce
      if (v === 'bars') {
        const bars = autoBarCount(16, 80, 6);
        const usable = Math.floor(fdLen * 0.88);
        const step = Math.max(1, usable / bars);
        const gapPx = 1.8;
        const bw = Math.max(2.5, (w - gapPx * (bars - 1)) / bars);

        let sAmp = ampRef.current;
        let sVel = velRef.current;
        if (!sAmp || sAmp.length !== bars) {
          sAmp = new Float32Array(bars);
          ampRef.current = sAmp;
        }
        if (!sVel || sVel.length !== bars) {
          sVel = new Float32Array(bars);
          velRef.current = sVel;
        }

        for (let i = 0; i < bars; i++) {
          const lo = Math.floor(i * step);
          const hi = Math.min(Math.ceil(lo + step), usable);
          const target = playing ? visEnergy(avgFreq(fd, lo, hi) * freqTilt(i, bars)) : 0;
          springChase(sAmp, sVel, i, target);
          const amp = sAmp[i]!;
          if (amp < 0.008) continue;
          const bh = Math.max(2.5, amp * h * 0.95);
          const c = paletteColorAtIndex(palette, i, bars);
          const x = i * (bw + gapPx);
          drawBar(x, h - bh, bw, bh, c, amp, Math.min(2.5, bw * 0.4));
        }
        return;
      }

      // ── Mirror ── mirrored bars with bounce
      if (v === 'mirror') {
        const bars = autoBarCount(14, 72, 6.5);
        const usable = Math.floor(fdLen * 0.88);
        const step = Math.max(1, usable / bars);
        const gapPx = 1.8;
        const bw = Math.max(2.5, (w - gapPx * (bars - 1)) / bars);
        const cy = h / 2;

        let sAmp = ampRef.current;
        let sVel = velRef.current;
        if (!sAmp || sAmp.length !== bars) {
          sAmp = new Float32Array(bars);
          ampRef.current = sAmp;
        }
        if (!sVel || sVel.length !== bars) {
          sVel = new Float32Array(bars);
          velRef.current = sVel;
        }

        for (let i = 0; i < bars; i++) {
          const lo = Math.floor(i * step);
          const hi = Math.min(Math.ceil(lo + step), usable);
          const target = playing ? visEnergy(avgFreq(fd, lo, hi) * freqTilt(i, bars)) : 0;
          springChase(sAmp, sVel, i, target);
          const amp = sAmp[i]!;
          if (amp < 0.008) continue;
          const half = Math.max(1.5, amp * h * 0.47);
          const c = paletteColorAtIndex(palette, i, bars);
          const x = i * (bw + gapPx);
          drawCBar(x, cy, bw, half, c, amp, Math.min(2.5, bw * 0.4));
        }
        return;
      }

      // ── Ribbon wave ── smooth bezier with aggressive response
      if (v === 'ribbon') {
        const pointCount = Math.max(64, Math.min(180, Math.floor(w / 1.8)));
        const usable = Math.max(4, Math.floor(fdLen * 0.88));
        const step = usable / pointCount;

        let sAmp = ampRef.current;
        let sVel = velRef.current;
        if (!sAmp || sAmp.length !== pointCount + 1) {
          sAmp = new Float32Array(pointCount + 1);
          ampRef.current = sAmp;
        }
        if (!sVel || sVel.length !== pointCount + 1) {
          sVel = new Float32Array(pointCount + 1);
          velRef.current = sVel;
        }

        const pts: { x: number; y: number }[] = [];
        for (let i = 0; i <= pointCount; i++) {
          const center = Math.min(usable - 1, i * step);
          const lo = Math.max(0, Math.floor(center - step * 0.6));
          const hi = Math.min(usable, Math.ceil(center + step * 0.6));
          const target = playing ? visEnergy(avgFreq(fd, lo, hi) * freqTilt(i, pointCount)) : 0;
          springChase(sAmp, sVel, i, target);
          const y = h - 3 - sAmp[i]! * (h - 6);
          pts.push({ x: (i / pointCount) * w, y });
        }

        const drawSmoothPath = () => {
          ctx.beginPath();
          ctx.moveTo(pts[0]!.x, pts[0]!.y);
          for (let i = 0; i < pts.length - 1; i++) {
            const p0 = pts[Math.max(0, i - 1)]!;
            const p1 = pts[i]!;
            const p2 = pts[i + 1]!;
            const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
            ctx.bezierCurveTo(
              p1.x + (p2.x - p0.x) / 6,
              p1.y + (p2.y - p0.y) / 6,
              p2.x - (p3.x - p1.x) / 6,
              p2.y - (p3.y - p1.y) / 6,
              p2.x,
              p2.y,
            );
          }
        };

        const n = palette.length;

        // Glow
        ctx.save();
        const gGlow = ctx.createLinearGradient(0, 0, w, 0);
        for (let i = 0; i < Math.max(1, n); i++) {
          gGlow.addColorStop(
            n > 1 ? i / (n - 1) : 0,
            applyAlphaToCssColor(palette[i] ?? '#737373', 0.4),
          );
        }
        if (n <= 1) gGlow.addColorStop(1, applyAlphaToCssColor(palette[0] ?? '#737373', 0.4));
        ctx.strokeStyle = gGlow;
        ctx.lineWidth = 5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.filter = 'blur(3px)';
        drawSmoothPath();
        ctx.stroke();
        ctx.restore();

        // Stroke
        const g = ctx.createLinearGradient(0, 0, w, 0);
        for (let i = 0; i < Math.max(1, n); i++) {
          g.addColorStop(n > 1 ? i / (n - 1) : 0, applyAlphaToCssColor(palette[i] ?? '#737373', 0.9));
        }
        if (n <= 1) g.addColorStop(1, applyAlphaToCssColor(palette[0] ?? '#737373', 0.9));
        ctx.strokeStyle = g;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        drawSmoothPath();
        ctx.stroke();

        // Fill
        const g2 = ctx.createLinearGradient(0, 0, 0, h);
        const mc = palette[Math.floor(n / 2)] ?? palette[0] ?? '#737373';
        g2.addColorStop(0, applyAlphaToCssColor(mc, 0.22));
        g2.addColorStop(0.6, applyAlphaToCssColor(mc, 0.06));
        g2.addColorStop(1, applyAlphaToCssColor(mc, 0));
        drawSmoothPath();
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fillStyle = g2;
        ctx.fill();
        return;
      }

      // ── Pulse bands ── aggressive bounce
      const segs = autoBarCount(14, 72, 6.5);
      const usableP = Math.floor(fdLen * 0.88);
      const stepP = Math.max(1, usableP / segs);
      const gapPx = 1.8;
      const bw = Math.max(2.5, (w - gapPx * (segs - 1)) / segs);
      const cy = h / 2;

      let sAmp = ampRef.current;
      let sVel = velRef.current;
      if (!sAmp || sAmp.length !== segs) {
        sAmp = new Float32Array(segs);
        ampRef.current = sAmp;
      }
      if (!sVel || sVel.length !== segs) {
        sVel = new Float32Array(segs);
        velRef.current = sVel;
      }

      for (let i = 0; i < segs; i++) {
        const lo = Math.floor(i * stepP);
        const hi = Math.min(Math.ceil(lo + stepP), usableP);
        const target = playing ? visEnergy(avgFreq(fd, lo, hi) * freqTilt(i, segs)) : 0;
        springChase(sAmp, sVel, i, target);
        const e = sAmp[i]!;
        if (e < 0.008) continue;
        const half = Math.max(1.5, e * h * 0.47);
        const c = paletteColorAtIndex(palette, i, segs);
        const x = i * (bw + gapPx);
        drawCBar(x, cy, bw, half, c, e, Math.min(2.5, bw * 0.4));
      }
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      ro.disconnect();
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      canvas.width = 0;
      canvas.height = 0;
      ampRef.current = null;
      velRef.current = null;
      freqRef.current = null;
    };
  }, [active, variant, mediaKey]);

  if (!active) return null;

  return (
    <div ref={wrapRef} className="relative w-full h-10 pointer-events-none">
      <canvas ref={canvasRef} className="absolute inset-0 block size-full" aria-hidden />
    </div>
  );
}
