import { useLayoutEffect, useRef } from 'react';
import { isMobile } from 'react-device-detect';
import { usePlayerContext } from '../../PlayerContext';
import AudioVisualizerBars from './AudioVisualizerBars';

type Props = {
  onLayoutHeight: (px: number) => void;
};

/**
 * Pinned to player bottom, always visible (not inside auto-hiding controls).
 * Parent lifts ControlBar by `onLayoutHeight` so seek sits above this strip.
 */
export default function PersistentBottomVisualizer({ onLayoutHeight }: Props) {
  const { audioVisualizer } = usePlayerContext();
  const wrapRef = useRef<HTMLDivElement>(null);
  const active = audioVisualizer && !isMobile;

  useLayoutEffect(() => {
    if (!active) {
      onLayoutHeight(0);
      return;
    }
    const el = wrapRef.current;
    if (!el) {
      onLayoutHeight(0);
      return;
    }
    const ro = new ResizeObserver(() => onLayoutHeight(el.offsetHeight));
    ro.observe(el);
    onLayoutHeight(el.offsetHeight);
    return () => {
      ro.disconnect();
      onLayoutHeight(0);
    };
  }, [active, onLayoutHeight]);

  if (!active) return null;

  return (
    <div
      ref={wrapRef}
      className="absolute bottom-0 left-0 right-0 z-[35] px-3 pb-2 pointer-events-none"
    >
      <AudioVisualizerBars />
    </div>
  );
}
