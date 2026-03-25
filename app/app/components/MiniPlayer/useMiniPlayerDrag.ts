import { useCallback, useRef, useState, useLayoutEffect, useEffect } from 'react';

const PADDING = 12;
const DRAG_THRESHOLD_PX = 4;
const SPRING_DURATION = 380;

type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

function getCornerPositions(elWidth: number, elHeight: number): Record<Corner, { x: number; y: number }> {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return {
    'top-left':     { x: PADDING, y: PADDING },
    'top-right':    { x: w - elWidth - PADDING, y: PADDING },
    'bottom-left':  { x: PADDING, y: h - elHeight - PADDING },
    'bottom-right': { x: w - elWidth - PADDING, y: h - elHeight - PADDING },
  };
}

function getNearestCorner(cx: number, cy: number, elWidth: number, elHeight: number) {
  const corners = getCornerPositions(elWidth, elHeight);
  const midX = cx + elWidth / 2;
  const midY = cy + elHeight / 2;

  let best: Corner = 'bottom-right';
  let bestDist = Infinity;

  for (const [corner, pos] of Object.entries(corners) as [Corner, { x: number; y: number }][]) {
    const dx = (pos.x + elWidth / 2) - midX;
    const dy = (pos.y + elHeight / 2) - midY;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = corner;
    }
  }

  return { ...corners[best], corner: best };
}

export function useMiniPlayerDrag() {
  // Start off-screen right edge so it's invisible before the first measure
  const [position, setPosition] = useState({ x: 99999, y: 99999 });
  const [isSnapping, setIsSnapping] = useState(false);
  const [mounted, setMounted] = useState(false);
  const isDragging = useRef(false);
  const didDragRef = useRef(false);
  const startRef = useRef({ pointerX: 0, pointerY: 0, elX: 0, elY: 0 });
  const positionRef = useRef(position);
  positionRef.current = position;
  const elSizeRef = useRef({ width: 340, height: 280 });
  const elementRef = useRef<HTMLDivElement | null>(null);

  // On mount: measure real size, place at bottom-right corner instantly (no animation)
  useLayoutEffect(() => {
    const el = elementRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    elSizeRef.current = { width: rect.width, height: rect.height };
    const corners = getCornerPositions(rect.width, rect.height);
    const target = corners['bottom-right'];
    setPosition({ x: target.x, y: target.y });
    // Allow spring transitions after first frame
    requestAnimationFrame(() => setMounted(true));
  }, []);

  // Re-snap on window resize
  useEffect(() => {
    const onResize = () => {
      if (isDragging.current) return;
      const el = elementRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        elSizeRef.current = { width: rect.width, height: rect.height };
      }
      const { width, height } = elSizeRef.current;
      const snap = getNearestCorner(positionRef.current.x, positionRef.current.y, width, height);
      setIsSnapping(true);
      setPosition({ x: snap.x, y: snap.y });
      setTimeout(() => setIsSnapping(false), SPRING_DURATION);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsSnapping(false);
    isDragging.current = true;
    didDragRef.current = false;
    startRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      elX: positionRef.current.x,
      elY: positionRef.current.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;

    const { pointerX, pointerY, elX, elY } = startRef.current;
    const dx = e.clientX - pointerX;
    const dy = e.clientY - pointerY;

    if (!didDragRef.current && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) {
      return;
    }
    didDragRef.current = true;
    setPosition({ x: elX + dx, y: elY + dy });
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    isDragging.current = false;

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch { /* already released */ }

    const el = elementRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      elSizeRef.current = { width: rect.width, height: rect.height };
    }

    const { width, height } = elSizeRef.current;
    const snap = getNearestCorner(positionRef.current.x, positionRef.current.y, width, height);
    setIsSnapping(true);
    setPosition({ x: snap.x, y: snap.y });
    setTimeout(() => setIsSnapping(false), SPRING_DURATION);

    setTimeout(() => { didDragRef.current = false; }, 0);
  }, []);

  return {
    elementRef,
    position,
    setPosition,
    isSnapping,
    mounted,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    didDragRef,
  };
}
