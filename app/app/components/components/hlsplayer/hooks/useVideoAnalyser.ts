import { useEffect, useState, type RefObject } from 'react';

type AudioGraph = {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  analyser: AnalyserNode;
};

/** Constructor for `AudioContext` / legacy `webkitAudioContext` (same instance type). */
type AudioContextConstructor = {
  new (contextOptions?: AudioContextOptions): AudioContext;
};

/** One MediaElementSource per video element (browser limitation). */
const graphByVideo = new WeakMap<HTMLVideoElement, AudioGraph>();

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof globalThis === 'undefined') return null;
  const g = globalThis as typeof globalThis & {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

async function resumeIfNeeded(ctx: AudioContext) {
  if (ctx.state === 'closed') return;
  if (ctx.state === 'running') return;
  try {
    await ctx.resume();
  } catch {
    /* iOS may reject until a user gesture */
  }
}

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

    const AudioCtx = getAudioContextConstructor();
    if (!AudioCtx) {
      setAnalyser(null);
      return;
    }

    const ensureGraph = () => {
      const v = videoRef.current;
      if (!v || v.readyState < HTMLMediaElement.HAVE_METADATA) return;

      let graph = graphByVideo.get(v);
      if (!graph) {
        try {
          const ctx = new AudioCtx({ latencyHint: 'playback' });
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
      void resumeIfNeeded(graph.ctx);
    };

    /**
     * iOS Safari: `createMediaElementSource` / `AudioContext.resume` often must run in a user gesture.
     * The effect’s first `ensureGraph()` is not a gesture; a later tap must retry the full path.
     */
    const onUserGesture = () => {
      ensureGraph();
    };

    const touchStartOpts: AddEventListenerOptions = { capture: true, passive: true };
    const touchEndOpts: AddEventListenerOptions = { capture: true, passive: true };
    const pointerOpts: AddEventListenerOptions = { capture: true };
    document.addEventListener('touchstart', onUserGesture, touchStartOpts);
    document.addEventListener('touchend', onUserGesture, touchEndOpts);
    document.addEventListener('pointerdown', onUserGesture, pointerOpts);
    document.addEventListener('click', onUserGesture, pointerOpts);

    ensureGraph();
    video.addEventListener('play', ensureGraph);
    video.addEventListener('loadeddata', ensureGraph);
    video.addEventListener('loadedmetadata', ensureGraph);

    return () => {
      document.removeEventListener('touchstart', onUserGesture, touchStartOpts);
      document.removeEventListener('touchend', onUserGesture, touchEndOpts);
      document.removeEventListener('pointerdown', onUserGesture, pointerOpts);
      document.removeEventListener('click', onUserGesture, pointerOpts);
      video.removeEventListener('play', ensureGraph);
      video.removeEventListener('loadeddata', ensureGraph);
      video.removeEventListener('loadedmetadata', ensureGraph);
      setAnalyser(null);
    };
  }, [enabled, videoRef]);

  return analyser;
}
