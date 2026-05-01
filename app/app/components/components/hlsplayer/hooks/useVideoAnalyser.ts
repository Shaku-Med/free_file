import { useEffect, useState, type RefObject } from 'react';
import {
  ensureAnalyser,
  ensureSharedGraph,
  resumeIfNeeded,
  setAnalyserActive,
} from '~/lib/audio/sharedAudioGraph';

/**
 * Taps the video element into Web Audio for spectrum data. The audio graph is shared
 * with the spatial-audio engine (`useSpatialAudio`) so both features can coexist —
 * `MediaElementAudioSource` can only exist once per `<video>`.
 */
export function useVideoAnalyser(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  /** Kept for callers; graph setup keys off `video.readyState` so mobile isn’t blocked if React `isLoaded` lags. */
  _mediaReady: boolean
): AnalyserNode | null {
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  useEffect(() => {
    if (!enabled) {
      setAnalyser(null);
      return;
    }

    const video = videoRef.current;
    if (!video) {
      setAnalyser(null);
      return;
    }

    const ensure = () => {
      const v = videoRef.current;
      if (!v) return;
      const graph = ensureSharedGraph(v);
      if (!graph) return;
      const node = ensureAnalyser(graph);
      setAnalyserActive(graph, true);
      setAnalyser(node);
      void resumeIfNeeded(graph.ctx);
    };

    /**
     * iOS Safari: `createMediaElementSource` / `AudioContext.resume` often must run in a user
     * gesture. The effect's first `ensure()` is not a gesture; later taps must retry.
     */
    const onUserGesture = () => ensure();

    const touchStartOpts: AddEventListenerOptions = { capture: true, passive: true };
    const touchEndOpts: AddEventListenerOptions = { capture: true, passive: true };
    const pointerOpts: AddEventListenerOptions = { capture: true };
    document.addEventListener('touchstart', onUserGesture, touchStartOpts);
    document.addEventListener('touchend', onUserGesture, touchEndOpts);
    document.addEventListener('pointerdown', onUserGesture, pointerOpts);
    document.addEventListener('click', onUserGesture, pointerOpts);

    ensure();
    video.addEventListener('play', ensure);
    video.addEventListener('loadeddata', ensure);
    video.addEventListener('loadedmetadata', ensure);

    return () => {
      document.removeEventListener('touchstart', onUserGesture, touchStartOpts);
      document.removeEventListener('touchend', onUserGesture, touchEndOpts);
      document.removeEventListener('pointerdown', onUserGesture, pointerOpts);
      document.removeEventListener('click', onUserGesture, pointerOpts);
      video.removeEventListener('play', ensure);
      video.removeEventListener('loadeddata', ensure);
      video.removeEventListener('loadedmetadata', ensure);
      const v = videoRef.current;
      if (v) {
        const graph = ensureSharedGraph(v);
        if (graph) setAnalyserActive(graph, false);
      }
      setAnalyser(null);
    };
  }, [enabled, videoRef]);

  return analyser;
}
