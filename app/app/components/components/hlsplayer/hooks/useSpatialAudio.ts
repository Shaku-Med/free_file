import { useEffect, useRef, type RefObject } from 'react';
import {
  ensureSharedGraph,
  resumeIfNeeded,
  setPannerActive,
  setPannerPosition,
} from '~/lib/audio/sharedAudioGraph';

export type SpatialAudioMode =
  | 'manual'
  | 'room-front'
  | 'orbit-horizontal'
  | 'orbit-vertical'
  | 'figure8';

export interface SpatialAudioConfig {
  /** Master toggle. When false the panner is detached and audio routes natively. */
  enabled: boolean;
  /** Animated mode (`orbit-*`, `figure8`) or static (`manual`, `room-front`). */
  mode: SpatialAudioMode;
  /** Manual position (used in `manual` mode). Each component is roughly in [-3, 3]; (0,0,-1) ≈ in front. */
  position: { x: number; y: number; z: number };
  /** Orbit radius for animated modes; 1 = around your head, larger = further away. */
  radius: number;
  /** Orbit speed in revolutions per second. 0.25 = a calm 4-second loop. */
  speedHz: number;
}

export const DEFAULT_SPATIAL_CONFIG: SpatialAudioConfig = {
  enabled: false,
  mode: 'orbit-horizontal',
  position: { x: 0, y: 0, z: -1 },
  radius: 1.5,
  speedHz: 0.25,
};

/**
 * Wires the spatial-audio panner into the shared audio graph for this video. While
 * `config.enabled` is false the panner is detached entirely and audio plays natively
 * (no HRTF cost). When enabled, an animation loop sweeps the panner position for
 * `orbit-*`/`figure8` modes; `manual`/`room-front` modes are static.
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

    let cancelled = false;
    let rafId: number | null = null;
    let startedAt = 0;

    const ensureAndApply = () => {
      const v = videoRef.current;
      if (!v) return;
      const graph = ensureSharedGraph(v);
      if (!graph) return;

      if (!configRef.current.enabled) {
        setPannerActive(graph, false);
        return;
      }

      setPannerActive(graph, true);
      void resumeIfNeeded(graph.ctx);

      // Apply current frame's position immediately so toggling the mode/position from the
      // dialog feels instant rather than waiting for the next rAF tick.
      applyPosition(performance.now());

      if (configRef.current.mode === 'manual' || configRef.current.mode === 'room-front') {
        if (rafId != null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        return;
      }

      if (rafId == null) {
        startedAt = performance.now();
        const tick = (now: number) => {
          if (cancelled) return;
          applyPosition(now);
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      }
    };

    const applyPosition = (now: number) => {
      const v = videoRef.current;
      if (!v) return;
      const graph = ensureSharedGraph(v);
      if (!graph) return;
      const cfg = configRef.current;

      if (cfg.mode === 'manual') {
        setPannerPosition(graph, cfg.position.x, cfg.position.y, cfg.position.z, 0.08);
        return;
      }
      if (cfg.mode === 'room-front') {
        // Stable "speaker in front of you" feel: fixed source slightly above ear level.
        // `radius` controls distance from listener (closer to a nearfield monitor vs room speaker).
        const distance = Math.max(0.6, cfg.radius * 1.8);
        setPannerPosition(graph, 0, 0.08, -distance, 0.12);
        return;
      }

      const elapsedSec = (now - startedAt) / 1000;
      const phase = elapsedSec * cfg.speedHz * Math.PI * 2;
      const r = cfg.radius;

      let x = 0;
      let y = 0;
      let z = -1;

      switch (cfg.mode) {
        case 'orbit-horizontal': {
          // Sound circles around your head at ear level — the classic "8D" effect.
          x = Math.sin(phase) * r;
          y = 0;
          z = -Math.cos(phase) * r;
          break;
        }
        case 'orbit-vertical': {
          // Tumbles overhead → behind → underfoot → in front → repeat.
          x = 0;
          y = Math.sin(phase) * r;
          z = -Math.cos(phase) * r;
          break;
        }
        case 'figure8': {
          // Lemniscate — sweeps a figure-8 in the horizontal plane.
          const denom = 1 + Math.sin(phase) * Math.sin(phase);
          x = (Math.cos(phase) * r) / denom;
          z = (-Math.sin(phase) * Math.cos(phase) * r) / denom;
          y = 0;
          break;
        }
      }

      // Short ramp keeps the motion glitch-free at high speeds without lagging behind.
      setPannerPosition(graph, x, y, z, 0.04);
    };

    /**
     * iOS Safari: `createMediaElementSource` / `AudioContext.resume` often must run inside
     * a user gesture. Same gesture-retry pattern as the analyser hook.
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
      if (rafId != null) cancelAnimationFrame(rafId);
      document.removeEventListener('touchstart', onUserGesture, touchStartOpts);
      document.removeEventListener('pointerdown', onUserGesture, pointerOpts);
      document.removeEventListener('click', onUserGesture, pointerOpts);
      const v = videoRef.current;
      if (v) {
        v.removeEventListener('play', ensureAndApply);
        v.removeEventListener('loadedmetadata', ensureAndApply);
      }
    };
    // Re-run when the toggle / mode change so the rAF loop starts/stops cleanly.
    // Position / radius / speed updates are read live via configRef without re-running.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef, config.enabled, config.mode]);
}
