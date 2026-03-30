import { useEffect, useState, type RefObject } from 'react';

type AudioGraph = {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  analyser: AnalyserNode;
};

/** One MediaElementSource per video element (browser limitation). */
const graphByVideo = new WeakMap<HTMLVideoElement, AudioGraph>();

/** Wider dB window + lower smoothing so spectrum bars use more of 0–255 (re-applied on cached graphs). */
function applyAnalyserTuning(node: AnalyserNode) {
  node.smoothingTimeConstant = 0.38;
  node.minDecibels = -100;
  node.maxDecibels = -28;
}

/**
 * Taps the video element into Web Audio for spectrum data.
 * Graph stays connected for the lifetime of the element so audio keeps routing to speakers.
 */
export function useVideoAnalyser(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  /** Set true once the element has media (e.g. player `isLoaded`) so we attach after the video exists. */
  mediaReady: boolean
): AnalyserNode | null {
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  useEffect(() => {
    if (!enabled || !mediaReady) {
      setAnalyser(null);
      return;
    }

    const video = videoRef.current;
    if (!video) {
      setAnalyser(null);
      return;
    }

    const ensureGraph = () => {
      const v = videoRef.current;
      if (!v) return;

      let graph = graphByVideo.get(v);
      if (!graph) {
        try {
          const ctx = new AudioContext({ latencyHint: 'playback' });
          const source = ctx.createMediaElementSource(v);
          const analyserNode = ctx.createAnalyser();
          analyserNode.fftSize = 2048;
          applyAnalyserTuning(analyserNode);
          source.connect(analyserNode);
          analyserNode.connect(ctx.destination);
          graph = { ctx, source, analyser: analyserNode };
          graphByVideo.set(v, graph);
        } catch {
          setAnalyser(null);
          return;
        }
      } else {
        applyAnalyserTuning(graph.analyser);
      }

      setAnalyser(graph.analyser);
      void graph.ctx.resume().catch(() => {});
    };

    ensureGraph();
    video.addEventListener('play', ensureGraph);
    video.addEventListener('loadeddata', ensureGraph);

    return () => {
      video.removeEventListener('play', ensureGraph);
      video.removeEventListener('loadeddata', ensureGraph);
      setAnalyser(null);
    };
  }, [enabled, mediaReady, videoRef]);

  return analyser;
}
