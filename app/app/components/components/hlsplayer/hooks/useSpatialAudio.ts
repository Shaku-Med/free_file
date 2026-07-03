import { useEffect, useRef, type RefObject } from 'react';
import { isMobile } from 'react-device-detect';
import {
  ensureSharedGraph,
  resumeIfNeeded,
  setPannerActive,
  setPannerPosition,
} from '~/lib/audio/sharedAudioGraph';

/**
 * Phone browsers (especially iOS Safari) make Web Audio + `MediaElementSource`
 * unreliable: silent output, gesture gates, and PiP quirks. We hide the feature
 * in the player UI and never activate the spatial panner on mobile UAs.
 */
export function isSpatialAudioUiSupported(): boolean {
  return !isMobile;
}

/**
 * Spatial-audio modes, ordered roughly from "subtle" to "trippy".
 *
 * - `stereo`    classic 8D feel: a wide L↔R sweep at ear level. This is what most
 *                people mean when they say "8D". Works on speakers and headphones.
 * - `orbit`     sound circles your head horizontally (HRTF). Headphones recommended.
 * - `tumble`    sound moves overhead → behind → underfoot → in front (HRTF).
 * - `figure8`   lemniscate sweep in the horizontal plane (HRTF).
 * - `manual`    fixed XYZ position you pick on the pad.
 * - `room-front`  stable "speakers in front of you" sweet spot  no motion.
 */
export type SpatialAudioMode =
  | 'stereo'
  | 'orbit'
  | 'tumble'
  | 'figure8'
  | 'manual'
  | 'room-front';

/** Animated modes run a rAF loop; static modes set position once. */
const ANIMATED_MODES: ReadonlyArray<SpatialAudioMode> = ['stereo', 'orbit', 'tumble', 'figure8'];

export function isAnimatedSpatialMode(mode: SpatialAudioMode): boolean {
  return ANIMATED_MODES.includes(mode);
}

export interface SpatialAudioConfig {
  /** Master toggle. When false the panner is detached and audio routes natively. */
  enabled: boolean;
  /** Movement pattern  see {@link SpatialAudioMode}. */
  mode: SpatialAudioMode;
  /** Manual position (used in `manual` mode). Each component is roughly in [-3, 3]. */
  position: { x: number; y: number; z: number };
  /** Orbit / sweep width: 1 ≈ at your ears, 3 = clearly out in the room. */
  radius: number;
  /** Orbit / sweep speed in revolutions per second. 0.25 = a calm 4-second loop. */
  speedHz: number;
}

export const DEFAULT_SPATIAL_CONFIG: SpatialAudioConfig = {
  enabled: false,
  mode: 'stereo',
  position: { x: 0, y: 0, z: -1 },
  radius: 1.6,
  speedHz: 0.25,
};

/**
 * Pure position math  given a config and a wall-clock timestamp (ms), returns the
 * panner position to apply. Shared with the dialog so the on-screen preview animates
 * in lock-step with the actual audio panner.
 */
export function computeSpatialPosition(
  config: SpatialAudioConfig,
  nowMs: number,
  startedAtMs: number,
): { x: number; y: number; z: number } {
  if (config.mode === 'manual') {
    return { ...config.position };
  }
  if (config.mode === 'room-front') {
    // Stable monitors in front of the listener. `radius` is more like "how far back
    // the sweet spot sits"; clamped so it never gets so close it feels mono.
    const distance = Math.max(0.6, config.radius * 1.2);
    return { x: 0, y: 0.05, z: -distance };
  }

  const elapsed = Math.max(0, (nowMs - startedAtMs) / 1000);
  const phase = elapsed * config.speedHz * Math.PI * 2;
  const r = config.radius;

  switch (config.mode) {
    case 'stereo': {
      // Hard L↔R sweep at ear level (z = 0). With HRTF + listener facing -Z, this
      // gives the classic flat "8D" rotation that sounds right on speakers too.
      // Slight forward bias (z = -0.15) keeps the source from collapsing exactly
      // on the listener at the zero crossing.
      return { x: Math.sin(phase) * r, y: 0, z: -0.15 };
    }
    case 'orbit': {
      // Circle around the head at ear level. The "real" 3D 8D effect on headphones.
      return { x: Math.sin(phase) * r, y: 0, z: -Math.cos(phase) * r };
    }
    case 'tumble': {
      return { x: 0, y: Math.sin(phase) * r, z: -Math.cos(phase) * r };
    }
    case 'figure8': {
      // Lemniscate of Bernoulli  sweeps an ∞ in the horizontal plane.
      const denom = 1 + Math.sin(phase) * Math.sin(phase);
      return {
        x: (Math.cos(phase) * r) / denom,
        y: 0,
        z: (-Math.sin(phase) * Math.cos(phase) * r) / denom,
      };
    }
  }

  return { x: 0, y: 0, z: -1 };
}

/**
 * Wires the spatial-audio panner into the shared audio graph for this video. While
 * `config.enabled` is false the panner is detached entirely and audio plays natively
 * (no HRTF cost). When enabled, an animation loop sweeps the panner position for
 * animated modes; `manual` / `room-front` are static.
 */
export function useSpatialAudio(
  videoRef: RefObject<HTMLVideoElement | null>,
  config: SpatialAudioConfig,
) {
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    /**
     * Keep spatial panner out of the chain on mobile (native element audio only).
     * Never while the VR theater holds it  its sound system owns the panner then.
     */
    const forcePannerOffMobile = () => {
      if (!isMobile) return;
      const v = videoRef.current;
      if (!v) return;
      const graph = ensureSharedGraph(v);
      if (graph && !graph.theaterActive) setPannerActive(graph, false);
    };

    if (isMobile) {
      forcePannerOffMobile();
      video.addEventListener('play', forcePannerOffMobile);
      video.addEventListener('loadedmetadata', forcePannerOffMobile);
      return () => {
        video.removeEventListener('play', forcePannerOffMobile);
        video.removeEventListener('loadedmetadata', forcePannerOffMobile);
      };
    }

    let cancelled = false;
    let rafId: number | null = null;
    let startedAt = 0;

    const stopAnimation = () => {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    const applyPosition = (now: number) => {
      const v = videoRef.current;
      if (!v) return;
      const graph = ensureSharedGraph(v);
      if (!graph) return;
      const cfg = configRef.current;
      const { x, y, z } = computeSpatialPosition(cfg, now, startedAt);
      // Short ramp keeps motion glitch-free even at the highest speeds.
      setPannerPosition(graph, x, y, z, 0.04);
    };

    const ensureAndApply = () => {
      const v = videoRef.current;
      if (!v) return;
      const graph = ensureSharedGraph(v);
      if (!graph) return;

      if (!configRef.current.enabled) {
        // 8D is off  release the panner, but ONLY if we own it. This handler
        // also fires from document-level gesture listeners, so without the
        // theater check every click on the page (like closing the settings
        // menu) would silently kill the VR theater's head tracked sound.
        if (!graph.theaterActive) setPannerActive(graph, false);
        stopAnimation();
        return;
      }

      setPannerActive(graph, true);
      void resumeIfNeeded(graph.ctx);

      // Apply the current frame's position immediately so toggling the mode/position
      // from the dialog feels instant rather than waiting for the next rAF tick.
      if (startedAt === 0) startedAt = performance.now();
      applyPosition(performance.now());

      if (!isAnimatedSpatialMode(configRef.current.mode)) {
        stopAnimation();
        return;
      }

      if (rafId == null) {
        const tick = (now: number) => {
          if (cancelled) return;
          applyPosition(now);
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      }
    };

    /**
     * iOS Safari: `createMediaElementSource` / `AudioContext.resume` often must run
     * inside a user gesture. Same gesture-retry pattern as the analyser hook.
     */
    const onUserGesture = () => ensureAndApply();
    const touchStartOpts: AddEventListenerOptions = { capture: true, passive: true };
    const pointerOpts: AddEventListenerOptions = { capture: true };
    document.addEventListener('touchstart', onUserGesture, touchStartOpts);
    document.addEventListener('pointerdown', onUserGesture, pointerOpts);
    document.addEventListener('click', onUserGesture, pointerOpts);

    ensureAndApply();
    video.addEventListener('play', ensureAndApply);
    video.addEventListener('loadedmetadata', ensureAndApply);

    return () => {
      cancelled = true;
      stopAnimation();
      document.removeEventListener('touchstart', onUserGesture, touchStartOpts);
      document.removeEventListener('pointerdown', onUserGesture, pointerOpts);
      document.removeEventListener('click', onUserGesture, pointerOpts);
      const v = videoRef.current;
      if (v) {
        v.removeEventListener('play', ensureAndApply);
        v.removeEventListener('loadedmetadata', ensureAndApply);
      }
    };
    // Re-run on toggle / mode change so the rAF loop starts/stops cleanly.
    // Position / radius / speed updates are read live via configRef without re-running.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef, config.enabled, config.mode]);
}
