import { useEffect, useRef } from 'react';
import { usePlayerContext } from '../../PlayerContext';
import type { AudioVisualizerStyle } from '../../audioVisualizerStyles';
import {
  applyAlphaToCssColor,
  buildPrimaryVisualizerPalette,
  lerpPaletteStops,
  paletteColorAtIndex,
  paletteToRgbStops,
  type RgbaStop,
} from '../../visualizerPalette';

type Props = {
  analyser: AnalyserNode | null;
  active: boolean;
  variant: AudioVisualizerStyle;
};

const SLOT_PX = 2.25;
const PAUSE_TAIL = 0.91;

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

function visEnergy(raw: number): number {
  const x = Math.min(1, raw * 4.2);
  return Math.min(1, Math.pow(x, 0.58));
}

export default function SeekBarSpectrum({ analyser, active, variant }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef(analyser);
  analyserRef.current = analyser;
  const variantRef = useRef(variant);
  variantRef.current = variant;

  const historyAmpRef = useRef<Float32Array | null>(null);
  const freqRef = useRef<Uint8Array | null>(null);
  const tdRef = useRef<Uint8Array | null>(null);
  const playingRef = useRef(false);
  const paletteRef = useRef<string[]>([]);
  const paletteRgbStopsRef = useRef<RgbaStop[]>([]);

  const { state } = usePlayerContext();
  playingRef.current = state.isPlaying && !state.isPaused;

  const tall = variant !== 'scroll';

  useEffect(() => {
    const syncPalette = () => {
      const p = buildPrimaryVisualizerPalette();
      paletteRef.current = p;
      paletteRgbStopsRef.current = paletteToRgbStops(p);
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

    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

      const slots = Math.max(8, Math.floor(w / SLOT_PX));
      historyAmpRef.current = new Float32Array(slots);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const drawCapsule = (
      x: number,
      centerY: number,
      amp: number,
      h: number,
      barW: number,
      baseColor: string,
      alpha?: { base: number; ampScale: number }
    ) => {
      const half = Math.max(1.25, amp * (h * 0.5));
      const top = centerY - half;
      const height = half * 2;
      const a0 = alpha?.base ?? 0.38;
      const ak = alpha?.ampScale ?? 0.55;
      ctx.fillStyle = applyAlphaToCssColor(baseColor, a0 + amp * ak);
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(x, top, barW, height, Math.min(1.25, barW * 0.5));
        ctx.fill();
      } else {
        ctx.fillRect(x, top, barW, height);
      }
    };

    let rafId = 0;
    let lastFrameTime = 0;
    const FRAME_BUDGET = 33;
    const tick = (now: number) => {
      rafId = requestAnimationFrame(tick);
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (now - lastFrameTime < FRAME_BUDGET) return;
      lastFrameTime = now;

      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w < 1 || h < 1) return;

      const a = analyserRef.current;
      const playing = playingRef.current;
      const v = variantRef.current;

      if (!a) {
        ctx.clearRect(0, 0, w, h);
        return;
      }

      let palette = paletteRef.current;
      if (palette.length === 0) {
        palette = buildPrimaryVisualizerPalette();
        paletteRef.current = palette;
        paletteRgbStopsRef.current = paletteToRgbStops(palette);
      }
      if (paletteRgbStopsRef.current.length === 0) {
        paletteRgbStopsRef.current = paletteToRgbStops(palette);
      }
      const rgbStops = paletteRgbStopsRef.current;

      const fdLen = a.frequencyBinCount;
      if (!freqRef.current || freqRef.current.length !== fdLen) {
        freqRef.current = new Uint8Array(fdLen);
      }
      const fd = freqRef.current;
      a.getByteFrequencyData(fd as Parameters<AnalyserNode['getByteFrequencyData']>[0]);

      const tdLen = a.fftSize;
      if (!tdRef.current || tdRef.current.length !== tdLen) {
        tdRef.current = new Uint8Array(tdLen);
      }
      const td = tdRef.current;
      a.getByteTimeDomainData(td as Parameters<AnalyserNode['getByteTimeDomainData']>[0]);

      let rms = 0;
      for (let i = 0; i < tdLen; i++) {
        const x = (td[i]! - 128) / 128;
        rms += x * x;
      }
      rms = Math.sqrt(rms / tdLen);
      const sample = Math.min(1, Math.pow(rms * 5.5, 0.82));

      ctx.clearRect(0, 0, w, h);

      if (v === 'scroll') {
        const slots = Math.max(8, Math.floor(w / SLOT_PX));
        let ampH = historyAmpRef.current;
        if (!ampH || ampH.length !== slots) {
          ampH = new Float32Array(slots);
          historyAmpRef.current = ampH;
        }

        if (!reduceMotion) {
          for (let i = 0; i < slots - 1; i++) {
            ampH[i] = ampH[i + 1]!;
          }
          ampH[slots - 1] = playing ? visEnergy(Math.min(1, sample * 1.35)) : 0;
          if (!playing) {
            for (let i = 0; i < slots; i++) {
              ampH[i] *= PAUSE_TAIL;
            }
          }
        } else if (playing) {
          for (let i = 0; i < slots - 1; i++) {
            ampH[i] = ampH[i + 1]!;
          }
          ampH[slots - 1] = visEnergy(Math.min(1, sample * 1.35));
        } else {
          for (let i = 0; i < slots; i++) ampH[i] *= PAUSE_TAIL;
        }

        const centerY = h / 2;
        const totalGap = w - slots * 1.35;
        const gap = slots > 1 ? Math.max(0.15, totalGap / (slots - 1)) : 0;
        const barW = Math.max(1.1, (w - gap * (slots - 1)) / slots);

        for (let i = 0; i < slots; i++) {
          const amp = ampH[i]!;
          if (amp < 0.002) continue;
          const x = i * (barW + gap);
          const t = slots > 1 ? i / (slots - 1) : 0;
          const c = lerpPaletteStops(rgbStops, t);
          drawCapsule(x, centerY, amp, h, barW, c, { base: 0.5, ampScale: 0.48 });
        }
        return;
      }

      if (v === 'bars') {
        const bars = Math.max(24, Math.min(100, Math.floor(w / 3.5)));
        const usable = Math.floor(fdLen * 0.88);
        const step = Math.max(1, Math.floor(usable / bars));
        const barGap = 0.2;
        const barW = w / bars;

        for (let i = 0; i < bars; i++) {
          const lo = i * step;
          const hi = Math.min(lo + step, usable);
          const vAvg = avgFreq(fd, lo, hi);
          const boosted = visEnergy(vAvg);
          const bh = Math.max(3, boosted * h * 0.94);
          const c = paletteColorAtIndex(palette, i, bars);
          const x = i * barW + barW * (barGap / 2);
          const bw = barW * (1 - barGap);
          ctx.fillStyle = applyAlphaToCssColor(c, 0.38 + boosted * 0.58);
          if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(x, h - bh, bw, bh, 2);
            ctx.fill();
          } else {
            ctx.fillRect(x, h - bh, bw, bh);
          }
        }
        return;
      }

      if (v === 'mirror') {
        const bars = Math.max(20, Math.min(80, Math.floor(w / 4)));
        const usable = Math.floor(fdLen * 0.88);
        const step = Math.max(1, Math.floor(usable / bars));
        const barGap = 0.18;
        const barW = w / bars;
        const cy = h / 2;

        for (let i = 0; i < bars; i++) {
          const lo = i * step;
          const hi = Math.min(lo + step, usable);
          const vAvg = avgFreq(fd, lo, hi);
          const boosted = visEnergy(vAvg);
          const half = Math.max(2, boosted * (h * 0.46));
          const c = paletteColorAtIndex(palette, i, bars);
          const x = i * barW + barW * (barGap / 2);
          const bw = barW * (1 - barGap);
          ctx.fillStyle = applyAlphaToCssColor(c, 0.36 + boosted * 0.56);
          if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(x, cy - half, bw, half * 2, 2);
            ctx.fill();
          } else {
            ctx.fillRect(x, cy - half, bw, half * 2);
          }
        }
        return;
      }

      if (v === 'ribbon') {
        const pointCount = Math.max(32, Math.min(96, Math.floor(w / 2)));
        const usable = Math.max(4, Math.floor(fdLen * 0.9));
        const step = usable / pointCount;
        const pts: { x: number; y: number }[] = [];
        for (let i = 0; i <= pointCount; i++) {
          const center = Math.min(usable - 1, i * step);
          const lo = Math.max(0, Math.floor(center - step * 0.6));
          const hi = Math.min(usable, Math.ceil(center + step * 0.6));
          const vAvg = avgFreq(fd, lo, hi);
          const y = h - 4 - visEnergy(vAvg) * (h - 8);
          const x = (i / pointCount) * w;
          pts.push({ x, y });
        }

        const g = ctx.createLinearGradient(0, 0, w, 0);
        const n = palette.length;
        if (n <= 1) {
          const c0 = palette[0] ?? '#737373';
          g.addColorStop(0, applyAlphaToCssColor(c0, 0.85));
          g.addColorStop(1, applyAlphaToCssColor(c0, 0.75));
        } else {
          for (let i = 0; i < n; i++) {
            g.addColorStop(i / (n - 1), applyAlphaToCssColor(palette[i]!, 0.82));
          }
        }
        ctx.beginPath();
        ctx.moveTo(pts[0]!.x, pts[0]!.y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
        ctx.strokeStyle = g;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke();

        const g2 = ctx.createLinearGradient(0, 0, w, 0);
        if (n <= 1) {
          const c0 = palette[0] ?? '#737373';
          g2.addColorStop(0, applyAlphaToCssColor(c0, 0.12));
          g2.addColorStop(1, applyAlphaToCssColor(c0, 0.1));
        } else {
          for (let i = 0; i < n; i++) {
            g2.addColorStop(i / (n - 1), applyAlphaToCssColor(palette[i]!, 0.12));
          }
        }
        ctx.beginPath();
        ctx.moveTo(pts[0]!.x, pts[0]!.y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fillStyle = g2;
        ctx.fill();
        return;
      }

      const segs = Math.max(32, Math.min(96, Math.floor(w / 2.8)));
      const usableP = Math.floor(fdLen * 0.88);
      const stepP = Math.max(1, Math.floor(usableP / segs));
      const segW = w / segs;
      const cy = h / 2;
      const gap = 0.14;
      for (let i = 0; i < segs; i++) {
        const lo = i * stepP;
        const hi = Math.min(lo + stepP, usableP);
        const vAvg = avgFreq(fd, lo, hi);
        const e = visEnergy(vAvg);
        if (e < 0.02) continue;
        const half = Math.max(1.5, e * (h * 0.47));
        const c = paletteColorAtIndex(palette, i, segs);
        const x = i * segW + segW * (gap / 2);
        const bw = Math.max(1, segW * (1 - gap));
        ctx.fillStyle = applyAlphaToCssColor(c, 0.42 + e * 0.52);
        if (typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(x, cy - half, bw, half * 2, 1.25);
          ctx.fill();
        } else {
          ctx.fillRect(x, cy - half, bw, half * 2);
        }
      }
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [active, variant]);

  if (!active) return null;

  return (
    <div
      ref={wrapRef}
      className={tall ? 'relative w-full h-10 pointer-events-none' : 'relative w-full h-[22px] pointer-events-none'}
    >
      <canvas ref={canvasRef} className="absolute inset-0 block size-full" aria-hidden />
    </div>
  );
}
