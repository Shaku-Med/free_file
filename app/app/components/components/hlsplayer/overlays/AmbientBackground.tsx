import { useRef, useEffect, useMemo } from 'react';
import { usePlayerContext } from '../PlayerContext';

function ensureHex(color: string): string {
  if (/^#([0-9A-Fa-f]{3}){1,2}$/.test(color)) return color;
  const m = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (m) {
    const r = parseInt(m[1], 10).toString(16).padStart(2, '0');
    const g = parseInt(m[2], 10).toString(16).padStart(2, '0');
    const b = parseInt(m[3], 10).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  return color;
}

const FALLBACK_COLORS = ['#1e3a5f', '#0f172a', '#020617'];

const SOFT_MASK =
  'radial-gradient(ellipse 80% 80% at 50% 50%, black 15%, rgba(0,0,0,0.4) 55%, transparent 90%)';

const SAMPLE_SIZE = 8;
const GRADIENT_SIZE = 32;
/** How often to resample video for ambient (ms). avoids per-frame work. */
const AMBIENT_SAMPLE_INTERVAL_MS = 1000;
/** Crossfade duration after each sample (rAF only during this window). */
const AMBIENT_TRANSITION_MS = 480;

function smoothstep01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

export default function AmbientBackground() {
  const { file, ambientMode, ambientColors, videoRef } = usePlayerContext();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaKey = file?.id ?? '';

  const fileColors = useMemo(() => {
    const c = (file as any)?.colors;
    if (Array.isArray(c)) return c.filter((x): x is string => typeof x === 'string');
    return [];
  }, [(file as any)?.colors]);

  const colors = ambientColors.length > 0 ? ambientColors : fileColors;
  const hexColors = useMemo(
    () => (colors.length > 0 ? colors.slice(0, 5).map(ensureHex) : FALLBACK_COLORS),
    [colors],
  );
  const colorKey = hexColors.join(',');

  useEffect(() => {
    if (!ambientMode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const video = videoRef.current;

    let ctx: CanvasRenderingContext2D | null = null;
    let cancelled = false;
    let trackingVideo = false;
    let intervalId: number | undefined;
    let transRaf = 0;
    let rawBuf: HTMLCanvasElement | null = null;
    let rawCtx: CanvasRenderingContext2D | null = null;
    let fromBuf: HTMLCanvasElement | null = null;
    let fromCtx: CanvasRenderingContext2D | null = null;
    let blendBuf: HTMLCanvasElement | null = null;
    let blendCtx: CanvasRenderingContext2D | null = null;
    let hasDisplayState = false;

    const clearSampleInterval = () => {
      if (intervalId !== undefined) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
    };

    const cancelTransition = () => {
      if (transRaf !== 0) {
        cancelAnimationFrame(transRaf);
        transRaf = 0;
      }
    };

    /** Drop video sampling state so a new source does not stack work. */
    const disposeVideoSamplingResources = () => {
      clearSampleInterval();
      cancelTransition();
      trackingVideo = false;
      hasDisplayState = false;
      for (const b of [rawBuf, fromBuf, blendBuf]) {
        if (b) {
          b.width = 0;
          b.height = 0;
        }
      }
      rawBuf = null;
      rawCtx = null;
      fromBuf = null;
      fromCtx = null;
      blendBuf = null;
      blendCtx = null;
      ctx = null;
    };

    const paintGradient = () => {
      if (trackingVideo) return;
      canvas.width = GRADIENT_SIZE;
      canvas.height = GRADIENT_SIZE;
      ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;
      const cx = GRADIENT_SIZE / 2;
      const cy = GRADIENT_SIZE / 2;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, GRADIENT_SIZE * 0.7);
      hexColors.forEach((c, i, arr) => {
        grad.addColorStop(i / (arr.length - 1 || 1), c);
      });
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, GRADIENT_SIZE, GRADIENT_SIZE);
    };

    const ensureVideoBuffers = () => {
      if (!trackingVideo) {
        trackingVideo = true;
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        ctx = canvas.getContext('2d', { alpha: false });
        rawBuf = document.createElement('canvas');
        rawBuf.width = SAMPLE_SIZE;
        rawBuf.height = SAMPLE_SIZE;
        rawCtx = rawBuf.getContext('2d', { alpha: false });
        fromBuf = document.createElement('canvas');
        fromBuf.width = SAMPLE_SIZE;
        fromBuf.height = SAMPLE_SIZE;
        fromCtx = fromBuf.getContext('2d', { alpha: false });
        blendBuf = document.createElement('canvas');
        blendBuf.width = SAMPLE_SIZE;
        blendBuf.height = SAMPLE_SIZE;
        blendCtx = blendBuf.getContext('2d', { alpha: true });
        hasDisplayState = false;
      }
    };

    const captureVideoToRaw = () => {
      if (!video || !rawCtx) return;
      rawCtx.drawImage(video, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    };

    /** Instant sample — seek / pause / first paint / hidden tab resume. */
    const snapVideoToDisplay = () => {
      if (cancelled || document.hidden) return;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;
      ensureVideoBuffers();
      if (!ctx || !rawCtx || !rawBuf) return;
      cancelTransition();
      try {
        captureVideoToRaw();
        ctx.drawImage(rawBuf, 0, 0);
        hasDisplayState = true;
      } catch {}
    };

    /** Interval sampling: crossfade from current display to new frame (rAF only for ~AMBIENT_TRANSITION_MS). */
    const sampleVideoCrossfade = () => {
      if (cancelled || document.hidden) return;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;
      ensureVideoBuffers();
      if (!ctx || !rawCtx || !rawBuf || !fromBuf || !fromCtx || !blendBuf || !blendCtx) return;
      try {
        captureVideoToRaw();
      } catch {
        return;
      }

      if (!hasDisplayState) {
        cancelTransition();
        try {
          ctx.drawImage(rawBuf, 0, 0);
          hasDisplayState = true;
        } catch {}
        return;
      }

      try {
        fromCtx.drawImage(canvas, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      } catch {
        return;
      }

      cancelTransition();
      const t0 = performance.now();

      const step = () => {
        if (cancelled || document.hidden) {
          transRaf = 0;
          return;
        }
        if (!ctx || !rawBuf || !fromBuf || !blendBuf || !blendCtx) {
          transRaf = 0;
          return;
        }
        const u = Math.min(1, (performance.now() - t0) / AMBIENT_TRANSITION_MS);
        const e = smoothstep01(u);
        blendCtx.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        blendCtx.globalCompositeOperation = 'source-over';
        blendCtx.globalAlpha = 1 - e;
        blendCtx.drawImage(fromBuf, 0, 0);
        blendCtx.globalAlpha = e;
        blendCtx.drawImage(rawBuf, 0, 0);
        blendCtx.globalAlpha = 1;
        try {
          ctx.drawImage(blendBuf, 0, 0);
        } catch {
          transRaf = 0;
          return;
        }
        if (u < 1) transRaf = requestAnimationFrame(step);
        else transRaf = 0;
      };

      transRaf = requestAnimationFrame(step);
    };

    const startSampleInterval = () => {
      clearSampleInterval();
      if (cancelled || !video || video.paused || video.ended || document.hidden) return;
      intervalId = window.setInterval(() => {
        if (cancelled || !video || video.paused || video.ended || document.hidden) {
          clearSampleInterval();
          return;
        }
        sampleVideoCrossfade();
      }, AMBIENT_SAMPLE_INTERVAL_MS);
    };

    const onPlay = () => {
      if (cancelled) return;
      clearSampleInterval();
      cancelTransition();
      snapVideoToDisplay();
      startSampleInterval();
    };
    const onPause = () => {
      clearSampleInterval();
      cancelTransition();
      snapVideoToDisplay();
    };
    const onSeeked = () => {
      if (!cancelled) snapVideoToDisplay();
    };
    const onLoaded = () => {
      if (cancelled) return;
      snapVideoToDisplay();
      if (video && !video.paused && !video.ended) startSampleInterval();
    };
    const onVisibility = () => {
      if (document.hidden) {
        clearSampleInterval();
        cancelTransition();
      } else if (video && !video.paused && !video.ended) {
        clearSampleInterval();
        snapVideoToDisplay();
        startSampleInterval();
      }
    };

    /** New media / emptied pipeline: kill animation + release buffers before next decode. */
    const onMediaCleared = () => {
      if (cancelled) return;
      disposeVideoSamplingResources();
      paintGradient();
    };

    paintGradient();
    if (!video) return;

    if (!video.paused && !video.ended) {
      snapVideoToDisplay();
      startSampleInterval();
    } else if (video.readyState >= 2) snapVideoToDisplay();

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('loadeddata', onLoaded);
    video.addEventListener('loadstart', onMediaCleared);
    video.addEventListener('emptied', onMediaCleared);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      disposeVideoSamplingResources();
      document.removeEventListener('visibilitychange', onVisibility);
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('loadstart', onMediaCleared);
      video.removeEventListener('emptied', onMediaCleared);
    };
  }, [ambientMode, videoRef, colorKey, mediaKey]);

  if (!ambientMode) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-0" aria-hidden>
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: '-20%',
          width: '140%',
          height: '140%',
          opacity: 0.72,
          filter: 'saturate(1.3)',
          maskImage: SOFT_MASK,
          WebkitMaskImage: SOFT_MASK,
        }}
      />
    </div>
  );
}
