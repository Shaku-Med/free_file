import { useState, useEffect, useRef, type RefObject } from 'react';

export function useControlBarWidth(containerRef: RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => setWidth(el.getBoundingClientRect().width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  const showTime = width >= 280;
  const showRightInline = width >= 420;
  const showVolumeSlider = width >= 340;

  return { width, showTime, showRightInline, showVolumeSlider };
}
