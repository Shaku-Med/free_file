import { useEffect, useRef } from 'react';
import { usePlayerContext } from '../PlayerContext';
import type Hls from 'hls.js';

const HISTORY_LEN = 100;
const SAMPLE_MS = 220;

/** Grafana-ish palette */
const COL = {
  bg: '#0e1116',
  grid: 'rgba(255,255,255,0.07)',
  stripBorder: 'rgba(255,255,255,0.06)',
  fps: '#73bf69',
  buf: '#5794f2',
  bw: '#f2cc0c',
  label: 'rgba(255,255,255,0.45)',
};

type Sample = { fps: number; buf: number; mbps: number };

function pushRing(buf: number[], v: number) {
  buf.push(v);
  if (buf.length > HISTORY_LEN) buf.shift();
}

function bufferAheadSec(video: HTMLVideoElement): number {
  const b = video.buffered;
  if (!b?.length) return 0;
  const t = video.currentTime;
  for (let i = 0; i < b.length; i++) {
    if (t >= b.start(i) && t <= b.end(i)) {
      return Math.max(0, b.end(i) - t);
    }
  }
  let best = 0;
  for (let i = 0; i < b.length; i++) {
    if (b.start(i) > t) best = Math.max(best, b.end(i) - t);
  }
  return best;
}

function sampleMetrics(
  video: HTMLVideoElement | null,
  hls: Hls | null,
  acc: { lastFrames: number; lastT: number },
  fpsSupported: { current: boolean }
): Sample {
  let fps = 0;
  let buf = 0;
  let mbps = 0;

  if (video) {
    buf = bufferAheadSec(video);
    const now = performance.now();
    const q = (
      video as HTMLVideoElement & {
        getVideoPlaybackQuality?: () => { totalVideoFrames?: number };
      }
    ).getVideoPlaybackQuality?.();
    if (typeof (video as HTMLVideoElement).getVideoPlaybackQuality === 'function') {
      fpsSupported.current = true;
    }
    if (q?.totalVideoFrames != null && acc.lastT > 0) {
      const dt = (now - acc.lastT) / 1000;
      if (dt >= 0.12) {
        const df = q.totalVideoFrames - acc.lastFrames;
        if (df >= 0 && dt > 0) fps = df / dt;
        acc.lastFrames = q.totalVideoFrames;
        acc.lastT = now;
      }
    } else if (q?.totalVideoFrames != null) {
      acc.lastFrames = q.totalVideoFrames;
      acc.lastT = now;
    } else {
      acc.lastT = now;
    }
  }

  if (hls) {
    const est = (hls as unknown as { bandwidthEstimate?: number }).bandwidthEstimate;
    if (est != null && Number.isFinite(est) && est > 0) mbps = est / 1e6;
  }

  return { fps, buf, mbps };
}

function drawStrip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  values: number[],
  max: number,
  color: string,
  label: string
) {
  ctx.strokeStyle = COL.stripBorder;
  ctx.strokeRect(x, y, w, h);

  const g0 = y + 2;
  const g1 = y + h - 2;
  const gh = g1 - g0;
  ctx.strokeStyle = COL.grid;
  ctx.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    const gy = g0 + (gh * i) / 4;
    ctx.beginPath();
    ctx.moveTo(x + 2, gy);
    ctx.lineTo(x + w - 2, gy);
    ctx.stroke();
  }

  const n = values.length;
  const m = Math.max(max * 0.2, ...values, 0.001);
  if (n >= 2) {
    const step = (w - 4) / (n - 1);
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    values.forEach((v, i) => {
      const px = x + 2 + i * step;
      const py = g1 - (Math.min(v, m) / m) * gh;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }

  ctx.fillStyle = COL.label;
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText(label, x + 4, y + 12);
}

function paint(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  fpsHist: number[],
  bufHist: number[],
  bwHist: number[],
  cur: Sample,
  fpsOk: boolean
) {
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, cw, ch);

  const pad = 6;
  const w = cw - pad * 2;
  const stripH = (ch - pad * 2 - 8) / 3;
  let y = pad;

  const fpsLabel =
    fpsOk && (cur.fps > 0 || fpsHist.some((v) => v > 0.5))
      ? `${cur.fps.toFixed(0)}`
      : '—';
  drawStrip(ctx, pad, y, w, stripH, fpsHist, 60, COL.fps, `FPS ${fpsLabel}`);
  y += stripH + 2;
  drawStrip(ctx, pad, y, w, stripH, bufHist, 30, COL.buf, `Buffer ${cur.buf.toFixed(1)}s`);
  y += stripH + 2;
  const bwLabel = cur.mbps >= 0.05 ? `${cur.mbps.toFixed(1)}` : '—';
  drawStrip(ctx, pad, y, w, stripH, bwHist, 12, COL.bw, `Mb/s ${bwLabel}`);

  ctx.fillStyle = COL.label;
  ctx.font = '9px ui-monospace, monospace';
  ctx.fillText('live', cw - pad - 22, ch - 4);
}

export default function StatsForNerdsOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { statsForNerds, videoRef, hlsRef } = usePlayerContext();

  const fpsHist = useRef<number[]>([]);
  const bufHist = useRef<number[]>([]);
  const bwHist = useRef<number[]>([]);
  const acc = useRef({ lastFrames: 0, lastT: 0 });
  const lastCur = useRef<Sample>({ fps: 0, buf: 0, mbps: 0 });
  const fpsSupported = useRef(false);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!statsForNerds) return;

    fpsHist.current = [];
    bufHist.current = [];
    bwHist.current = [];
    acc.current = { lastFrames: 0, lastT: 0 };
    fpsSupported.current = false;

    const sample = () => {
      const v = videoRef.current;
      const hls = hlsRef.current;
      const s = sampleMetrics(v, hls, acc.current, fpsSupported);
      lastCur.current = s;
      pushRing(fpsHist.current, s.fps);
      pushRing(bufHist.current, s.buf);
      pushRing(bwHist.current, s.mbps);
    };

    sample();
    const interval = window.setInterval(sample, SAMPLE_MS);

    const loop = () => {
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (canvas && wrap) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const cssW = wrap.clientWidth;
        const cssH = 96;
        canvas.width = Math.floor(cssW * dpr);
        canvas.height = Math.floor(cssH * dpr);
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          paint(
            ctx,
            cssW,
            cssH,
            fpsHist.current,
            bufHist.current,
            bwHist.current,
            lastCur.current,
            fpsSupported.current
          );
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      clearInterval(interval);
      cancelAnimationFrame(rafRef.current);
    };
  }, [statsForNerds, videoRef, hlsRef]);

  if (!statsForNerds) return null;

  const v = videoRef.current;
  const res =
    v && v.videoWidth > 0 && v.videoHeight > 0 ? `${v.videoWidth}×${v.videoHeight}` : null;

  return (
    <div
      ref={wrapRef}
      className="pointer-events-none absolute left-2 top-2 z-[60] w-[min(92vw,220px)] select-none sm:left-3 sm:top-3 sm:w-[240px]"
      aria-label="Playback stats"
    >
      <div className="mb-1 text-[9px] font-medium uppercase tracking-wide text-white/40">Stats</div>
      <canvas
        ref={canvasRef}
        className="block w-full rounded-md border border-white/15 shadow-md"
        aria-hidden
      />
      {res ? (
        <div className="mt-1 text-center font-mono text-[10px] text-white/35">{res}</div>
      ) : null}
    </div>
  );
}
