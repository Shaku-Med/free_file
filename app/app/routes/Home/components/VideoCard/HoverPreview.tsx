import { useEffect, useRef, useState } from "react";
import type { FileType } from "~/lib/types";
import { cachedPreview, loadPreview, previewUrlFor } from "~/lib/files/hoverPreview";

const HOVER_DELAY_MS = 700;

/**
 * Silent looping preview layered over a card thumbnail.
 *
 * Mounts as an overlay and binds its listeners to the PARENT element, so
 * dropping it inside an existing thumbnail wrapper needs no other changes.
 * Touch devices have no hover, so those play once the card is properly in view.
 */
export default function HoverPreview({ file }: { file: Partial<FileType> }) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const url = previewUrlFor(file);
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
      if (cancelled || src) return;
      setLoading(true);
      loadPreview(url, controller.signal).then((objectUrl) => {
        if (cancelled) return;
        setLoading(false);
        if (objectUrl) setSrc(objectUrl);
      });
    };

    const enter = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(begin, HOVER_DELAY_MS);
    };

    const leave = () => {
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

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= 0.6) enter();
          else leave();
        }
      },
      { threshold: [0, 0.6, 1] },
    );
    io.observe(parent);
    return () => {
      cancelled = true;
      controller.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
      io.disconnect();
    };
  }, [url, src]);

  // Autoplay can be refused; treat that as "no preview" rather than a stuck frame.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    v.play().catch(() => setReady(false));
  }, [src]);

  if (!url) return null;

  return (
    <div ref={holderRef} className="pointer-events-none absolute inset-0 z-[2]">
      {loading && (
        <div className="absolute inset-x-0 top-0 h-[3px] overflow-hidden bg-primary/15">
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
          playsInline
          preload="auto"
          disablePictureInPicture
          onCanPlay={() => setReady(true)}
          onError={() => setReady(false)}
          // Thumbnail stays visible underneath until the first frame is ready.
          className={`h-full w-full object-cover transition-opacity duration-200 ${
            ready ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </div>
  );
}
