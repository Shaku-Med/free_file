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

    const clearSampleInterval = () => {
      if (intervalId !== undefined) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
    };

    /** Drop video sampling state so a new source does not stack work. */
    const disposeVideoSamplingResources = () => {
      clearSampleInterval();
      trackingVideo = false;
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

    const ensureVideoCanvas = () => {
      if (!trackingVideo) {
        trackingVideo = true;
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        ctx = canvas.getContext('2d', { alpha: false });
      }
    };

    /** Single cheap sample: one drawImage, no offscreen blending. */
    const sampleVideo = () => {
      if (cancelled || document.hidden) return;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;
      ensureVideoCanvas();
      if (!ctx) return;
      try {
        ctx.drawImage(video, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      } catch {}
    };

    const startSampleInterval = () => {
      clearSampleInterval();
      if (cancelled || !video || video.paused || video.ended || document.hidden) return;
      intervalId = window.setInterval(() => {
        if (cancelled || !video || video.paused || video.ended || document.hidden) {
          clearSampleInterval();
          return;
        }
        sampleVideo();
      }, AMBIENT_SAMPLE_INTERVAL_MS);
    };

    const onPlay = () => {
      if (cancelled) return;
      clearSampleInterval();
      sampleVideo();
      startSampleInterval();
    };
    const onPause = () => {
      clearSampleInterval();
      sampleVideo();
    };
    const onSeeked = () => {
      if (!cancelled) sampleVideo();
    };
    const onLoaded = () => {
      if (cancelled) return;
      sampleVideo();
      if (video && !video.paused && !video.ended) startSampleInterval();
    };
    const onVisibility = () => {
      if (document.hidden) clearSampleInterval();
      else if (video && !video.paused && !video.ended) {
        clearSampleInterval();
        sampleVideo();
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
      sampleVideo();
      startSampleInterval();
    } else if (video.readyState >= 2) sampleVideo();

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
