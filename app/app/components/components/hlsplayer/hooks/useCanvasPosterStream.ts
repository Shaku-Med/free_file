import { useEffect, useRef, type RefObject } from 'react';

// Feeds a <video> element a live MediaStream painted from a canvas (poster
// image + spinning ring). Used during an HLS source swap on mobile, where
// going into native fullscreen takes our React poster overlay off-screen and
// a black frame between the old and new manifest looks like a crash.
//
// While `active` is true the video shows the canvas; when it flips back to
// false we stop the stream and clear srcObject so the host (hls.js
// attachMedia, native HLS, etc.) can take over again.
//
// SECURITY: poster URL must be same-origin or CORS-enabled  otherwise the
// canvas becomes tainted and captureStream() throws. We ship the poster from
// /api/load/image which is same-origin, so this is fine in-app.

interface UseCanvasPosterStreamOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Poster image URL. Falls back to a plain black canvas when null. */
  posterUrl: string | null;
  /** Show the canvas stream while this is true; release when false. */
  active: boolean;
  /** Canvas size in pixels. Bigger = sharper but more CPU. */
  width?: number;
  height?: number;
  /** Frames per second; 24 is plenty for a spinner. */
  fps?: number;
}

export function useCanvasPosterStream({
  videoRef,
  posterUrl,
  active,
  width = 1280,
  height = 720,
  fps = 24,
}: UseCanvasPosterStreamOptions): void {
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!active || !video) return;
    if (typeof document === 'undefined') return;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    let imgReady = false;
    img.onload = () => {
      imgReady = true;
    };
    if (posterUrl) img.src = posterUrl;

    let startTs = performance.now();
    const drawSpinner = (now: number) => {
      const elapsed = (now - startTs) / 1000;

      // Background  black, then the poster covered if loaded.
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (imgReady && img.naturalWidth > 0) {
        const iw = img.naturalWidth;
        const ih = img.naturalHeight;
        const srcAr = iw / ih;
        const dstAr = canvas.width / canvas.height;
        let dw: number;
        let dh: number;
        if (srcAr > dstAr) {
          dh = canvas.height;
          dw = dh * srcAr;
        } else {
          dw = canvas.width;
          dh = dw / srcAr;
        }
        const dx = (canvas.width - dw) / 2;
        const dy = (canvas.height - dh) / 2;
        try {
          ctx.drawImage(img, dx, dy, dw, dh);
        } catch {
          // tainted canvas (poster failed CORS)  fall through to plain black
        }
      }

      // Dim a touch so the spinner reads.
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Spinning ring.
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const r = Math.min(canvas.width, canvas.height) * 0.06;
      const turns = elapsed * 1.2; // turns per second
      const start = turns * Math.PI * 2;
      ctx.lineWidth = Math.max(3, r * 0.18);
      ctx.lineCap = 'round';
      // Faint track behind the spinner.
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      // Bright arc.
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.beginPath();
      ctx.arc(cx, cy, r, start, start + Math.PI * 1.4);
      ctx.stroke();

      // One-liner under the spinner. Friendly, no explanation  the user just
      // needs to know we're not frozen.
      const fontSize = Math.max(16, r * 0.55);
      ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText('Hold on, almost there…', cx, cy + r + fontSize * 0.9);

      rafRef.current = requestAnimationFrame(drawSpinner);
    };
    rafRef.current = requestAnimationFrame(drawSpinner);

    // captureStream() may not exist on very old WebViews. Guard cleanly.
    const capture = (
      canvas as HTMLCanvasElement & { captureStream?: (fps: number) => MediaStream }
    ).captureStream;
    if (!capture) {
      cancelAnimationFrame(rafRef.current);
      return;
    }

    let stream: MediaStream;
    try {
      stream = capture.call(canvas, fps);
    } catch {
      cancelAnimationFrame(rafRef.current);
      return;
    }
    streamRef.current = stream;

    // Apply to the video. We DO NOT touch video.src so when the host
    // reattaches HLS via hls.attachMedia / video.src=..., it overrides
    // srcObject and our stream is naturally taken offline.
    try {
      video.srcObject = stream;
      // Inline + autoplay on mobile needs muted/playsinline; the host video
      // element already sets these, so .play() should resolve.
      void video.play().catch(() => {
        /* ignore  some browsers reject when host swaps quickly */
      });
    } catch {
      /* ignore */
    }

    return () => {
      cancelAnimationFrame(rafRef.current);
      // Don't null srcObject if a real source has already taken over  the
      // host swap clears it implicitly. Only clean if we're still the source.
      try {
        if (video.srcObject === stream) {
          video.srcObject = null;
        }
      } catch {
        /* ignore */
      }
      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
      streamRef.current = null;
    };
  }, [active, posterUrl, videoRef, width, height, fps]);
}
