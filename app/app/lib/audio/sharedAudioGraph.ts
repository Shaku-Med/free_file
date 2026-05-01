/**
 * Shared per-video Web Audio graph. Browsers only let you create ONE
 * `MediaElementAudioSource` per `<video>` element, so the audio visualizer (analyser)
 * and the spatial-audio engine (panner) must talk to the same source.
 *
 * Default routing: `source → destination` (transparent — no DSP).
 * With analyser: `source → analyser → destination`.
 * With panner:   `source → panner → destination`.
 * Both:          `source → panner → analyser → destination`.
 *
 * Toggling either feature reconnects the chain in-place; the source / panner / analyser
 * nodes themselves are never recreated until the video element is garbage-collected.
 */

type AudioContextConstructor = {
  new (contextOptions?: AudioContextOptions): AudioContext;
};

export interface SharedAudioGraph {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  /** Always present; only inserted into the audio path when `pannerActive` is true. */
  panner: PannerNode;
  /** Created lazily; only inserted when `analyserActive` is true. */
  analyser: AnalyserNode | null;
  pannerActive: boolean;
  analyserActive: boolean;
}

const graphByVideo = new WeakMap<HTMLVideoElement, SharedAudioGraph>();

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof globalThis === 'undefined') return null;
  const g = globalThis as typeof globalThis & {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

export async function resumeIfNeeded(ctx: AudioContext) {
  if (ctx.state === 'closed' || ctx.state === 'running') return;
  try {
    await ctx.resume();
  } catch {
    /* iOS may reject until a user gesture */
  }
}

/**
 * Returns the cached graph for this video, creating it if needed. Returns null when
 * Web Audio is unavailable or the video isn't ready (no metadata yet) so callers can
 * retry on `loadedmetadata` / user gesture.
 */
export function ensureSharedGraph(video: HTMLVideoElement): SharedAudioGraph | null {
  const cached = graphByVideo.get(video);
  if (cached) return cached;

  const AudioCtx = getAudioContextConstructor();
  if (!AudioCtx) return null;
  if (video.readyState < HTMLMediaElement.HAVE_METADATA) return null;

  try {
    const ctx = new AudioCtx({ latencyHint: 'playback' });
    const source = ctx.createMediaElementSource(video);
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.maxDistance = 10000;
    panner.rolloffFactor = 1;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 0;
    panner.coneOuterGain = 0;
    // Default position: directly in front of the listener at unit distance — a
    // transparent baseline for when spatial audio is disabled.
    setPannerPositionImmediate(panner, ctx, 0, 0, -1);

    // Listener faces -Z by default with up = +Y. Keep that explicit so we don't depend on
    // browser defaults that vary across implementations.
    if ('positionX' in ctx.listener) {
      ctx.listener.positionX.value = 0;
      ctx.listener.positionY.value = 0;
      ctx.listener.positionZ.value = 0;
      ctx.listener.forwardX.value = 0;
      ctx.listener.forwardY.value = 0;
      ctx.listener.forwardZ.value = -1;
      ctx.listener.upX.value = 0;
      ctx.listener.upY.value = 1;
      ctx.listener.upZ.value = 0;
    }

    const graph: SharedAudioGraph = {
      ctx,
      source,
      panner,
      analyser: null,
      pannerActive: false,
      analyserActive: false,
    };
    rewireGraph(graph);
    graphByVideo.set(video, graph);
    return graph;
  } catch {
    return null;
  }
}

/** Lazily creates the analyser node on first use; idempotent thereafter. */
export function ensureAnalyser(graph: SharedAudioGraph): AnalyserNode {
  if (graph.analyser) return graph.analyser;
  const node = graph.ctx.createAnalyser();
  node.fftSize = 2048;
  node.smoothingTimeConstant = 0.38;
  node.minDecibels = -100;
  node.maxDecibels = -28;
  graph.analyser = node;
  return node;
}

export function setAnalyserActive(graph: SharedAudioGraph, active: boolean) {
  if (graph.analyserActive === active) return;
  graph.analyserActive = active;
  rewireGraph(graph);
}

export function setPannerActive(graph: SharedAudioGraph, active: boolean) {
  if (graph.pannerActive === active) return;
  graph.pannerActive = active;
  rewireGraph(graph);
}

/**
 * Smoothly slides panner position toward the target over `rampSeconds` seconds. Use 0
 * for an immediate snap. Targets outside roughly [-3, 3] start to fall under the
 * inverse-distance attenuation, which is intentional for the "far" presets.
 */
export function setPannerPosition(
  graph: SharedAudioGraph,
  x: number,
  y: number,
  z: number,
  rampSeconds = 0.05,
) {
  const t = graph.ctx.currentTime;
  const ramp = Math.max(0, rampSeconds);
  if ('positionX' in graph.panner) {
    graph.panner.positionX.cancelScheduledValues(t);
    graph.panner.positionY.cancelScheduledValues(t);
    graph.panner.positionZ.cancelScheduledValues(t);
    if (ramp <= 0) {
      graph.panner.positionX.setValueAtTime(x, t);
      graph.panner.positionY.setValueAtTime(y, t);
      graph.panner.positionZ.setValueAtTime(z, t);
    } else {
      graph.panner.positionX.linearRampToValueAtTime(x, t + ramp);
      graph.panner.positionY.linearRampToValueAtTime(y, t + ramp);
      graph.panner.positionZ.linearRampToValueAtTime(z, t + ramp);
    }
  } else {
    // Legacy WebKit fallback (Safari < 14): no AudioParam, only setPosition.
    (graph.panner as PannerNode & { setPosition?: (x: number, y: number, z: number) => void })
      .setPosition?.(x, y, z);
  }
}

function setPannerPositionImmediate(
  panner: PannerNode,
  ctx: AudioContext,
  x: number,
  y: number,
  z: number,
) {
  if ('positionX' in panner) {
    panner.positionX.setValueAtTime(x, ctx.currentTime);
    panner.positionY.setValueAtTime(y, ctx.currentTime);
    panner.positionZ.setValueAtTime(z, ctx.currentTime);
  } else {
    (panner as PannerNode & { setPosition?: (x: number, y: number, z: number) => void })
      .setPosition?.(x, y, z);
  }
}

function rewireGraph(graph: SharedAudioGraph) {
  try {
    graph.source.disconnect();
  } catch {}
  if (graph.analyser) {
    try {
      graph.analyser.disconnect();
    } catch {}
  }
  try {
    graph.panner.disconnect();
  } catch {}

  let head: AudioNode = graph.source;
  if (graph.pannerActive) {
    head.connect(graph.panner);
    head = graph.panner;
  }
  if (graph.analyserActive && graph.analyser) {
    head.connect(graph.analyser);
    head = graph.analyser;
  }
  head.connect(graph.ctx.destination);
}
