/**
 * Shared per-video Web Audio graph. Browsers only let you create ONE
 * `MediaElementAudioSource` per `<video>` element, so the audio visualizer (analyser)
 * and the spatial-audio engine (panner) must talk to the same source.
 *
 * Default routing: `source → destination` (transparent  no DSP).
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
  /**
   * Created lazily; inserted at the tail of the chain when `compressorActive` is true.
   * Used for the "stable volume" feature  gentle compression so quiet clips and loud
   * clips end up at roughly the same perceived loudness.
   */
  compressor: DynamicsCompressorNode | null;
  /** Tiny makeup gain to offset the compressor's threshold reduction (~1.4x). */
  makeupGain: GainNode | null;
  /**
   * Created lazily for the VR theater "sound system": a synthetic room reverb
   * (convolver) blended wet/dry. Sits right after the panner so the direct
   * sound is seat-positioned and the reverb fills the room around it.
   */
  theater: {
    convolver: ConvolverNode;
    dryGain: GainNode;
    wetGain: GainNode;
    mixOut: GainNode;
  } | null;
  pannerActive: boolean;
  analyserActive: boolean;
  compressorActive: boolean;
  theaterActive: boolean;
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
    // Linear with a tiny rolloff over a generous max distance keeps the perceived
    // loudness close to the native track even at radius 3+, while still giving
    // a subtle "further = quieter" cue when users push the orbit out wide.
    panner.distanceModel = 'linear';
    panner.refDistance = 1;
    panner.maxDistance = 12;
    panner.rolloffFactor = 0.25;
    // Omnidirectional source: every direction is "inside" the inner cone.
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 360;
    panner.coneOuterGain = 1;
    // Default position: directly in front of the listener at unit distance  a
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
      compressor: null,
      makeupGain: null,
      theater: null,
      pannerActive: false,
      analyserActive: false,
      compressorActive: false,
      theaterActive: false,
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
  node.smoothingTimeConstant = 0.45;
  // Headroom so loud content doesn't peg every bin at 255 (which makes the bars
  // sit pinned at full height with only the tips moving, and hides bass kicks).
  node.minDecibels = -90;
  node.maxDecibels = -20;
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
 * Lazily creates the compressor + makeup gain on first use. The settings are tuned for
 * loudness leveling (taming loud peaks while preserving dynamics) rather than aggressive
 * compression  close to a "broadcast" preset.
 */
export function ensureCompressor(graph: SharedAudioGraph): DynamicsCompressorNode {
  if (graph.compressor && graph.makeupGain) return graph.compressor;
  const compressor = graph.ctx.createDynamicsCompressor();
  const now = graph.ctx.currentTime;
  compressor.threshold.setValueAtTime(-22, now);
  compressor.knee.setValueAtTime(20, now);
  compressor.ratio.setValueAtTime(4, now);
  compressor.attack.setValueAtTime(0.006, now);
  compressor.release.setValueAtTime(0.25, now);
  const makeupGain = graph.ctx.createGain();
  makeupGain.gain.setValueAtTime(1.4, now);
  graph.compressor = compressor;
  graph.makeupGain = makeupGain;
  return compressor;
}

export function setCompressorActive(graph: SharedAudioGraph, active: boolean) {
  if (graph.compressorActive === active) return;
  if (active) ensureCompressor(graph);
  graph.compressorActive = active;
  rewireGraph(graph);
}

/**
 * Synthetic theater impulse response: ~12ms pre-delay (walls are far), then
 * exponentially decaying stereo-decorrelated noise (~1.2s tail). Cheap to
 * generate, no asset download, and reads convincingly as "big dark room".
 */
function buildTheaterImpulse(ctx: AudioContext): AudioBuffer {
  const seconds = 1.2;
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(seconds * rate));
  const preDelay = Math.floor(0.012 * rate);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = preDelay; i < length; i++) {
      const decay = Math.pow(1 - (i - preDelay) / (length - preDelay), 2.6);
      data[i] = (Math.random() * 2 - 1) * decay;
    }
  }
  return buffer;
}

/** Lazily creates the theater reverb stage; idempotent thereafter. */
export function ensureTheater(graph: SharedAudioGraph) {
  if (graph.theater) return graph.theater;
  const convolver = graph.ctx.createConvolver();
  convolver.buffer = buildTheaterImpulse(graph.ctx);
  const dryGain = graph.ctx.createGain();
  dryGain.gain.value = 0.92;
  const wetGain = graph.ctx.createGain();
  wetGain.gain.value = 0.25;
  const mixOut = graph.ctx.createGain();
  mixOut.gain.value = 1;
  graph.theater = { convolver, dryGain, wetGain, mixOut };
  return graph.theater;
}

export function setTheaterActive(graph: SharedAudioGraph, active: boolean) {
  if (graph.theaterActive === active) return;
  if (active) ensureTheater(graph);
  graph.theaterActive = active;
  rewireGraph(graph);
}

/** Reverb amount  back rows get more room, front rows mostly direct sound. */
export function setTheaterWet(graph: SharedAudioGraph, wet: number, rampSeconds = 0.25) {
  const theater = ensureTheater(graph);
  const t = graph.ctx.currentTime;
  const clamped = Math.max(0, Math.min(0.6, wet));
  theater.wetGain.gain.cancelScheduledValues(t);
  theater.wetGain.gain.linearRampToValueAtTime(clamped, t + Math.max(0.01, rampSeconds));
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
  if (graph.compressor) {
    try {
      graph.compressor.disconnect();
    } catch {}
  }
  if (graph.makeupGain) {
    try {
      graph.makeupGain.disconnect();
    } catch {}
  }
  if (graph.theater) {
    try {
      graph.theater.convolver.disconnect();
      graph.theater.dryGain.disconnect();
      graph.theater.wetGain.disconnect();
      graph.theater.mixOut.disconnect();
    } catch {}
  }

  let head: AudioNode = graph.source;
  if (graph.pannerActive) {
    head.connect(graph.panner);
    head = graph.panner;
  }
  if (graph.theaterActive && graph.theater) {
    head.connect(graph.theater.dryGain);
    graph.theater.dryGain.connect(graph.theater.mixOut);
    head.connect(graph.theater.convolver);
    graph.theater.convolver.connect(graph.theater.wetGain);
    graph.theater.wetGain.connect(graph.theater.mixOut);
    head = graph.theater.mixOut;
  }
  if (graph.analyserActive && graph.analyser) {
    head.connect(graph.analyser);
    head = graph.analyser;
  }
  if (graph.compressorActive && graph.compressor && graph.makeupGain) {
    head.connect(graph.compressor);
    graph.compressor.connect(graph.makeupGain);
    head = graph.makeupGain;
  }
  head.connect(graph.ctx.destination);
}
