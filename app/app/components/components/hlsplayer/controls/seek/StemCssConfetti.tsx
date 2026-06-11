import { useEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { usePlayerContext } from '../../PlayerContext';
import { stemEventIndexAt, type AudioStems, type StemType } from '../../audioStems';
import { confettiRuntimeConfig } from '../../confettiSettings';
import {
  buildStemConfettiThemePalettes,
  STEM_CONFETTI_META,
  stemConfettiColors,
  type StemConfettiThemePalettes,
} from '../../stemConfettiSettings';
import {
  applyWrapLayout,
  CONFETTI_Z_ABOVE_MINI,
  readAnchorRect,
  stackZAbovePlayer,
  type PlayerRect,
} from './confettiLayout';
import './stemConfetti.css';

const STEM_SEEK_RESYNC_S = 1.5;
const STEM_FRESH_WINDOW_S = 0.25;
const MAX_DOM_PIECES = 140;

/**
 * Corner cannons: every burst fires from the player's FOUR corners, pieces
 * shooting diagonally outward (away from the player) with spread, then
 * arcing down under gravity. Nothing spawns from the visualizer strip.
 */
function spawnStemPieces(
  layer: HTMLElement,
  rect: PlayerRect,
  rt: ReturnType<typeof confettiRuntimeConfig>,
  type: StemType,
  strength: number,
  palettes: StemConfettiThemePalettes,
) {
  const meta = STEM_CONFETTI_META[type];
  const { primary, secondary } = stemConfettiColors(type, palettes);
  const count = Math.max(
    4,
    Math.round(
      (4 + Math.floor(Math.random() * 4)) * rt.countMul * meta.count * (0.55 + strength * 0.75),
    ),
  );
  const active = layer.querySelectorAll('.hls-stem-confetti-piece').length;
  const budget = Math.max(0, MAX_DOM_PIECES - active);

  // Wrap-local corner positions (the wrap extends spill px beyond the player).
  const corners = [
    { x: rt.spillSide, y: rt.spillTop, sx: -1, sy: -1 },
    { x: rt.spillSide + rect.width, y: rt.spillTop, sx: 1, sy: -1 },
    { x: rt.spillSide, y: rt.spillTop + rect.height, sx: -1, sy: 1 },
    { x: rt.spillSide + rect.width, y: rt.spillTop + rect.height, sx: 1, sy: 1 },
  ] as const;
  const cornerOffset = Math.floor(Math.random() * 4);

  for (let i = 0; i < count && i < budget; i++) {
    const corner = corners[(i + cornerOffset) % 4]!;
    const el = document.createElement('div');
    el.className = 'hls-stem-confetti-piece';
    el.dataset.stem = type;

    const size = (4 + Math.random() * 4) * meta.size * (0.85 + strength * 0.35);
    const color = Math.random() > 0.45 ? primary : secondary;

    // Outward diagonal ±35° of spread, distance scales with hit strength.
    const dist = (46 + Math.random() * 72) * (0.75 + strength * 0.7);
    const angle = Math.PI / 4 + ((Math.random() - 0.5) * Math.PI * 35) / 90;
    const outX = corner.sx * dist * Math.cos(angle);
    const outY = corner.sy * dist * Math.sin(angle);
    // Gravity always wins: even up-fired pieces arc over and fall.
    const fall = 60 + Math.random() * (80 + strength * 70);

    el.style.setProperty('--hls-confetti-w', `${size}px`);
    el.style.setProperty('--hls-confetti-h', `${size * 0.62}px`);
    el.style.setProperty('--hls-confetti-color', color);
    el.style.setProperty('--hls-confetti-x', `${corner.x + (Math.random() - 0.5) * 10}px`);
    el.style.setProperty('--hls-confetti-y', `${corner.y + (Math.random() - 0.5) * 10}px`);
    el.style.setProperty('--hls-confetti-dx', `${outX}px`);
    el.style.setProperty('--hls-confetti-pop', `${outY}px`);
    el.style.setProperty('--hls-confetti-fall', `${fall}px`);
    el.style.setProperty('--hls-confetti-rot', `${Math.random() * 360}deg`);
    el.style.setProperty('--hls-confetti-spin', `${(Math.random() - 0.5) * 520}deg`);
    el.style.setProperty('--hls-confetti-dur', `${820 + Math.random() * 540}ms`);
    el.style.setProperty('--hls-confetti-delay', `${Math.floor(Math.random() * 70)}ms`);

    el.addEventListener('animationend', () => el.remove(), { once: true });
    layer.appendChild(el);
  }
}

type StemCssConfettiProps = {
  stems: AudioStems;
  anchorRef?: RefObject<HTMLElement | null>;
};

/** Stem-synced confetti using DOM + CSS animations (no canvas). */
export default function StemCssConfetti({ stems, anchorRef: anchorRefProp }: StemCssConfettiProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stackZRef = useRef(48);
  const palettesRef = useRef(buildStemConfettiThemePalettes());

  const { state, containerRef, videoRef, stemConfettiInstruments } = usePlayerContext();

  const stemsRef = useRef(stems);
  stemsRef.current = stems;
  const stemIdxRef = useRef(0);
  const stemLastTimeRef = useRef(0);
  const instrumentsRef = useRef(stemConfettiInstruments);
  instrumentsRef.current = stemConfettiInstruments;

  const anchorRefPropRef = useRef(anchorRefProp);
  anchorRefPropRef.current = anchorRefProp;
  const isMiniAnchorRef = useRef(false);

  useEffect(() => {
    const sync = () => {
      palettesRef.current = buildStemConfettiThemePalettes();
    };
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);

  const resolveAnchor = (): HTMLElement | null => {
    const anchorProp = anchorRefPropRef.current;
    if (anchorProp) {
      isMiniAnchorRef.current = true;
      return anchorProp.current;
    }
    isMiniAnchorRef.current = false;
    return containerRef.current;
  };

  const playingRef = useRef(false);
  playingRef.current = state.isPlaying && !state.isPaused;

  useEffect(() => {
    stemIdxRef.current = 0;
    stemLastTimeRef.current = 0;
    layerRef.current?.replaceChildren();
  }, [stems]);

  useEffect(() => {
    let rafId: number | null = null;
    let tensionEnv = 0.25;

    const tick = () => {
      rafId = requestAnimationFrame(tick);

      const anchor = resolveAnchor();
      const layer = layerRef.current;
      if (!anchor || !layer) return;

      const rect = readAnchorRect(anchor);
      if (!rect) return;

      stackZRef.current = isMiniAnchorRef.current
        ? CONFETTI_Z_ABOVE_MINI
        : stackZAbovePlayer(anchor);

      const rt = confettiRuntimeConfig(tensionEnv);
      const wrap = wrapRef.current;
      if (wrap) applyWrapLayout(wrap, rect, rt, stackZRef.current);

      const hidden = typeof document !== 'undefined' && document.visibilityState !== 'visible';
      const video = videoRef.current;
      const stemData = stemsRef.current;
      const enabled = instrumentsRef.current;
      const palettes = palettesRef.current;

      if (!hidden && video && stemData && playingRef.current) {
        const t = video.currentTime;
        const evs = stemData.events;
        let idx = stemIdxRef.current;
        if (t < stemLastTimeRef.current - 0.05 || t - stemLastTimeRef.current > STEM_SEEK_RESYNC_S) {
          idx = stemEventIndexAt(evs, t);
        }
        while (idx < evs.length && evs[idx]!.t <= t) {
          const e = evs[idx]!;
          idx++;
          if (t - e.t > STEM_FRESH_WINDOW_S) continue;
          if (!enabled[e.type]) continue;
          const tension = Math.min(1, 0.35 + e.s * 0.65);
          tensionEnv = tensionEnv * 0.8 + tension * 0.2;
          spawnStemPieces(layer, rect, confettiRuntimeConfig(tension), e.type, tension, palettes);
        }
        stemIdxRef.current = idx;
        stemLastTimeRef.current = t;
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      layerRef.current?.replaceChildren();
    };
  }, [containerRef, videoRef]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={wrapRef}
      aria-hidden
      className="hls-stem-confetti-layer pointer-events-none fixed block"
      style={{ zIndex: stackZRef.current }}
    >
      <div ref={layerRef} className="relative h-full w-full" />
    </div>,
    document.body,
  );
}
