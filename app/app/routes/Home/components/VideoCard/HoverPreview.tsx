import { useEffect, useRef, useState } from "react";
import type { FileType } from "~/lib/types";
import {
  cachedPreview,
  loadPreview,
  needsAuthenticatedFetch,
  previewUrlFor,
} from "~/lib/files/hoverPreview";

const HOVER_DELAY_MS = 700;

/**
 * Silent looping preview layered over a card thumbnail.
 *
 * Binds its listeners to the PARENT element, so dropping it inside an existing
 * thumbnail wrapper needs no other changes. Touch devices have no hover, so
 * those play once the card is properly in view.
 */
export default function HoverPreview({ file }: { file: Partial<FileType> }) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True only between enter and leave. Without it, the seek that leave() does
  // fires canplay again and the video re-appears after the pointer has gone.
  const activeRef = useRef(false);

  const url = previewUrlFor(file);
  const needsAuth = needsAuthenticatedFetch(file);

  const [src, setSrc] = useState<string | null>(() => (url ? cachedPreview(url) ?? null : null));
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!url) return;
    const parent = holderRef.current?.parentElement;
    if (!parent) return;

    let cancelled = false;
    const controller = new AbortController();

    const begin = () => {
      if (cancelled || !activeRef.current) return;
      if (src) {
        // Already loaded, so canplay will not fire again. Make it visible here
        // or a second hover leaves it stuck at opacity-0.
        const v = videoRef.current;
        if (v) {
          if (v.readyState >= 2) setReady(true);
          void v.play().catch(() => {});
        }
        return;
      }
      setLoading(true);
      loadPreview(url, controller.signal, needsAuth).then((objectUrl) => {
        if (cancelled) return;
        setLoading(false);
        // Pointer may have left while this was in flight.
        if (objectUrl && activeRef.current) setSrc(objectUrl);
      });
    };

    const enter = () => {
      activeRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(begin, HOVER_DELAY_MS);
    };

    const leave = () => {
      activeRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      setLoading(false);
      setReady(false);
      const v = videoRef.current;
      if (v) {
        v.pause();
        v.currentTime = 0;
      }
    };

    const canHover =
      typeof window !== "undefined" &&
      window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;

    if (canHover) {
      parent.addEventListener("mouseenter", enter);
      parent.addEventListener("mouseleave", leave);
      return () => {
        cancelled = true;
        controller.abort();
        if (timerRef.current) clearTimeout(timerRef.current);
        parent.removeEventListener("mouseenter", enter);
        parent.removeEventListener("mouseleave", leave);
      };
    }

    // Touch has no hover, and playing whatever scrolls into view burns data on
    // cards nobody asked about. Require a deliberate press-and-hold instead,
    // cancelled the moment the finger moves so scrolling never triggers it.
    let startY = 0;
    const onStart = (e: TouchEvent) => {
      startY = e.touches[0]?.clientY ?? 0;
      enter();
    };
    const onMove = (e: TouchEvent) => {
      if (Math.abs((e.touches[0]?.clientY ?? 0) - startY) > 8) leave();
    };
    parent.addEventListener("touchstart", onStart, { passive: true });
    parent.addEventListener("touchmove", onMove, { passive: true });
    parent.addEventListener("touchend", leave, { passive: true });
    parent.addEventListener("touchcancel", leave, { passive: true });
    return () => {
      cancelled = true;
      controller.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
      parent.removeEventListener("touchstart", onStart);
      parent.removeEventListener("touchmove", onMove);
      parent.removeEventListener("touchend", leave);
      parent.removeEventListener("touchcancel", leave);
    };
  }, [url, src, needsAuth]);

  // A cached blob can already be decodable before React attaches onLoadedData,
  // in which case that event never fires and the video stays invisible.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    if (!activeRef.current) return;
    if (v.readyState >= 2) setReady(true);
    v.play().catch(() => {});
  }, [src]);

  if (!url) return null;

  return (
    <div ref={holderRef} className="pointer-events-none absolute inset-0 z-[20]">
      {loading && (
        <div className="absolute inset-x-0 top-0 z-[1] h-[3px] overflow-hidden bg-primary/20">
          <div className="h-full w-1/3 rounded-full bg-primary [animation:hoverPreviewSlide_1.1s_ease-in-out_infinite]" />
          <style>{`@keyframes hoverPreviewSlide{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>
        </div>
      )}

      {src && (
        <video
          ref={videoRef}
          src={src}
          muted
          loop
          autoPlay
          playsInline
          preload="auto"
          disablePictureInPicture
          onLoadedData={() => { if (activeRef.current) setReady(true); }}
          onCanPlay={() => { if (activeRef.current) setReady(true); }}
          onError={(e) => { console.log('[HoverPreview] VIDEO ERROR', (e.target as HTMLVideoElement)?.error); setReady(false); }}
          className={`h-full w-full bg-black object-cover transition-opacity duration-200 ${
            ready ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </div>
  );
}
