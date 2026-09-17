/**
 * Shared per-video Web Audio graph. Browsers only let you create ONE
 * `MediaElementAudioSource` per `<video>` element, so the audio visualizer (analyser)
 * and the spatial-audio engine (panner) must talk to the same source.
 *
 * Default routing: `source → destination` (transparent  no DSP).
 * With analyser: `source → analyser → destination`.
 * With panner:   `source → panner → destination`.
 * Both:          `source → panner → analyser → destination`.
 * With reverb the wet send branches off `source` rather than the panner, so the
 * room is a fixed place around the listener and only the direct sound travels.
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
   * Created lazily: a synthetic room reverb blended wet/dry, shared by the VR
   * theater and 8D. The send is tapped BEFORE the panner, so the direct sound
   * moves while the room stays put. A reverb that pans with the source is the
   * main thing that makes spatial audio sound like an effect rather than a place.
   */
  reverb: {
    room: ReverbRoom;
    convolver: ConvolverNode;
    /** Keeps the tail out of the bass, where it only turns into mud. */
    highpass: BiquadFilterNode;
    /** Live tone control: distance and room size darken the tail. */
    damping: BiquadFilterNode;
    dryGain: GainNode;
    wetGain: GainNode;
    mixOut: GainNode;
  } | null;
  pannerActive: boolean;
  analyserActive: boolean;
  compressorActive: boolean;
  reverbActive: boolean;
  /** The VR room owns the panner while this is set; 8D stands down. */
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
    panner.rolloffFactor = DEFAULT_ROLLOFF;
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
      reverb: null,
      pannerActive: false,
      analyserActive: false,
      compressorActive: false,
      reverbActive: false,
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

export type ReverbRoom = 'room' | 'theater' | 'hall' | 'cathedral';

interface RoomSpec {
  seconds: number;
  /** Gap before the first reflection: how far the walls are. */
  preDelay: number;
  /** Tail decay curve; lower means the room rings on longer. */
  decay: number;
  /** 0 keeps the tail glassy and bright, 1 soaks the highs up fast. */
  damping: number;
  earlyCount: number;
  earlyGain: number;
  /** Where the live tone control sits by default. */
  toneHz: number;
}

const ROOMS: Record<ReverbRoom, RoomSpec> = {
  room: { seconds: 0.9, preDelay: 0.007, decay: 2.4, damping: 0.6, earlyCount: 9, earlyGain: 1.6, toneHz: 7000 },
  theater: { seconds: 1.8, preDelay: 0.016, decay: 2.3, damping: 0.62, earlyCount: 13, earlyGain: 1.3, toneHz: 5200 },
  hall: { seconds: 2.4, preDelay: 0.022, decay: 1.9, damping: 0.5, earlyCount: 11, earlyGain: 1.0, toneHz: 6000 },
  cathedral: { seconds: 4.5, preDelay: 0.035, decay: 1.5, damping: 0.42, earlyCount: 8, earlyGain: 0.8, toneHz: 4200 },
};

/** Deterministic noise, so a given room sounds identical every time it is built. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Synthetic room impulse. Three things separate this from a plain noise burst,
 * and all three are what the ear actually uses to place a sound in a space:
 * discrete early reflections off the near walls, a tail whose highs die before
 * its lows the way soft surfaces and air absorb them, and a short build up
 * instead of the tail switching on at full level.
 *
 * Normalised to unit energy per channel so every room sits at the same loudness
 * for a given wet amount, and the two channels use independent noise so the
 * room is wide rather than a point behind your forehead.
 */
function buildRoomImpulse(ctx: AudioContext, room: ReverbRoom): AudioBuffer {
  const spec = ROOMS[room];
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(spec.seconds * rate));
  const buffer = ctx.createBuffer(2, length, rate);
  const rand = mulberry32(0x9e3779b9 ^ Math.round(spec.seconds * 1000));
  const buildSamples = Math.max(1, 0.012 * rate);

  // Both curves depend only on how far into the tail we are, and they move
  // slowly, so table them instead of calling pow twice per sample. A long room
  // is ~190k samples per channel and that cost lands on a click.
  const STEPS = 1024;
  const openTable = new Float32Array(STEPS);
  const gainTable = new Float32Array(STEPS);
  for (let k = 0; k < STEPS; k++) {
    const age = k / (STEPS - 1);
    const a = Math.max(0.02, Math.min(1, 1 - spec.damping + spec.damping * Math.pow(1 - age, 3)));
    openTable[k] = a;
    // A one pole loses level as it closes; put it back so damping darkens the
    // tail instead of just shortening it.
    gainTable[k] = Math.sqrt((2 - a) / a) * Math.pow(1 - age, spec.decay);
  }

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    const start = Math.floor(spec.preDelay * rate) + Math.floor(rand() * 0.003 * rate);
    const tail = Math.max(1, length - start);

    for (let k = 0; k < spec.earlyCount; k++) {
      const frac = (k + 1) / spec.earlyCount;
      const at = start + Math.floor((0.004 + frac * frac * 0.086 + rand() * 0.004) * rate);
      if (at >= length) break;
      const amp = spec.earlyGain * Math.pow(1 - frac, 1.4) * (0.6 + rand() * 0.4);
      data[at] += k % 2 === 0 ? amp : -amp;
    }

    // Every non-zero sample lives in this range, early taps included, so the
    // energy for normalising can be accumulated here rather than in a second pass.
    const ageScale = (STEPS - 1) / tail;
    let energy = 0;
    let lp = 0;
    let hp = 0;
    let prev = 0;
    for (let i = start; i < length; i++) {
      const age = i - start;
      const k = (age * ageScale) | 0;
      lp += openTable[k] * (rand() * 2 - 1 - lp);
      hp = 0.995 * (hp + lp - prev);
      prev = lp;
      const build = age < buildSamples ? age / buildSamples : 1;
      const sample = data[i] + hp * gainTable[k] * build;
      data[i] = sample;
      energy += sample * sample;
    }

    const scale = energy > 0 ? 1 / Math.sqrt(energy) : 0;
    for (let i = start; i < length; i++) data[i] *= scale;
  }
  return buffer;
}

/** Lazily creates the reverb stage, and swaps the impulse when the room changes. */
export function ensureReverb(graph: SharedAudioGraph, requested: ReverbRoom = 'room') {
  const room: ReverbRoom = requested in ROOMS ? requested : 'room';
  if (graph.reverb) {
    if (graph.reverb.room !== room) {
      graph.reverb.room = room;
      graph.reverb.convolver.buffer = buildRoomImpulse(graph.ctx, room);
      graph.reverb.damping.frequency.value = ROOMS[room].toneHz;
    }
    return graph.reverb;
  }

  const ctx = graph.ctx;
  const convolver = ctx.createConvolver();
  // Our own energy normalisation instead of the browser's, which varies with
  // impulse length and would make each room a different loudness.
  convolver.normalize = false;
  convolver.buffer = buildRoomImpulse(ctx, room);

  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 140;

  const damping = ctx.createBiquadFilter();
  damping.type = 'lowpass';
  damping.frequency.value = ROOMS[room].toneHz;
  damping.Q.value = 0.7;

  const dryGain = ctx.createGain();
  dryGain.gain.value = 1;
  const wetGain = ctx.createGain();
  wetGain.gain.value = 0;
  const mixOut = ctx.createGain();
  mixOut.gain.value = 1;

  graph.reverb = { room, convolver, highpass, damping, dryGain, wetGain, mixOut };
  return graph.reverb;
}

/** Gentle default so the 8D orbits stay near native loudness even at radius 3+. */
const DEFAULT_ROLLOFF = 0.25;
/**
 * Steeper rolloff while the VR theater drives the panner: moving toward the
 * screen should be clearly louder and backing away clearly quieter, like
 * walking around a real room. Restored on exit so 8D keeps its subtle curve.
 */
const THEATER_ROLLOFF = 0.85;

/**
 * The stage as it stands. Mix and tone must never pass a room of their own:
 * doing that would rebuild the impulse on every call, and the VR loop calls
 * them several times a second.
 */
function reverbStage(graph: SharedAudioGraph) {
  return graph.reverb ?? ensureReverb(graph);
}

export function setReverbActive(
  graph: SharedAudioGraph,
  active: boolean,
  room: ReverbRoom = 'room',
) {
  if (active) {
    const reverb = ensureReverb(graph, room);
    if (graph.reverbActive) return;
    graph.reverbActive = true;
    reverb.mixOut.gain.value = 1;
  } else {
    if (!graph.reverbActive) return;
    graph.reverbActive = false;
  }
  rewireGraph(graph);
}

/**
 * Reverb amount. The dry path ducks a little as the room comes up, so turning
 * the reverb on adds space instead of just volume.
 */
export function setReverbMix(graph: SharedAudioGraph, wet: number, rampSeconds = 0.25) {
  const reverb = reverbStage(graph);
  const t = graph.ctx.currentTime;
  const ramp = Math.max(0.01, rampSeconds);
  // A non finite value here throws inside the AudioParam and takes the whole
  // render loop with it, so it never gets that far.
  const clamped = Number.isFinite(wet) ? Math.max(0, Math.min(0.6, wet)) : 0;
  reverb.wetGain.gain.cancelScheduledValues(t);
  reverb.wetGain.gain.linearRampToValueAtTime(clamped, t + ramp);
  reverb.dryGain.gain.cancelScheduledValues(t);
  reverb.dryGain.gain.linearRampToValueAtTime(1 - clamped * 0.45, t + ramp);
}

/** Darkens or opens the tail: far away and big rooms lose their highs. */
export function setReverbTone(graph: SharedAudioGraph, cutoffHz: number, rampSeconds = 0.25) {
  const reverb = reverbStage(graph);
  const t = graph.ctx.currentTime;
  const clamped = Number.isFinite(cutoffHz) ? Math.max(700, Math.min(12_000, cutoffHz)) : 6000;
  reverb.damping.frequency.cancelScheduledValues(t);
  reverb.damping.frequency.linearRampToValueAtTime(clamped, t + Math.max(0.01, rampSeconds));
}

/** Default tone for a room, for callers that don't drive it live. */
export function reverbRoomTone(room: ReverbRoom): number {
  return (ROOMS[room] ?? ROOMS.room).toneHz;
}

export function setTheaterActive(graph: SharedAudioGraph, active: boolean) {
  if (graph.theaterActive === active) return;
  graph.theaterActive = active;
  graph.panner.rolloffFactor = active ? THEATER_ROLLOFF : DEFAULT_ROLLOFF;
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
  if (graph.reverb) {
    try {
      graph.reverb.convolver.disconnect();
      graph.reverb.highpass.disconnect();
      graph.reverb.damping.disconnect();
      graph.reverb.dryGain.disconnect();
      graph.reverb.wetGain.disconnect();
      graph.reverb.mixOut.disconnect();
    } catch {}
  }

  let head: AudioNode = graph.source;
  if (graph.pannerActive) {
    head.connect(graph.panner);
    head = graph.panner;
  }
  if (graph.reverbActive && graph.reverb) {
    const r = graph.reverb;
    head.connect(r.dryGain);
    r.dryGain.connect(r.mixOut);
    // Send taken from the source, ahead of the panner: the direct sound moves
    // around you, the room it is in does not.
    graph.source.connect(r.highpass);
    r.highpass.connect(r.convolver);
    r.convolver.connect(r.damping);
    r.damping.connect(r.wetGain);
    r.wetGain.connect(r.mixOut);
    head = r.mixOut;
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
