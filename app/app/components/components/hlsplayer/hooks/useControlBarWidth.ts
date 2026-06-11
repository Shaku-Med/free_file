import { useState, useLayoutEffect, useRef, type RefObject } from 'react';
import { mobileControlMetrics, type MobileControlMetrics } from '../controls/mobileControlMetrics';

const DEFAULT_MOBILE_METRICS = mobileControlMetrics(360, 640);

export function useControlBarWidth(containerRef: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const rafRef = useRef(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        setSize((prev) =>
          prev.width === r.width && prev.height === r.height
            ? prev
            : { width: r.width, height: r.height },
        );
      });
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [containerRef]);

  const width = size.width;
  const height = size.height;
  const showTime = width >= 280;
  const showRightInline = width >= 420;
  const showVolumeSlider = width >= 340;
  const mobileMetrics: MobileControlMetrics =
    width > 0 && height > 0 ? mobileControlMetrics(width, height) : DEFAULT_MOBILE_METRICS;

  return { width, height, showTime, showRightInline, showVolumeSlider, mobileMetrics };
}
