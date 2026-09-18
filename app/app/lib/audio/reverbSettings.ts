import {
  reverbRoomTone,
  setReverbLowCut,
  setReverbMix,
  setReverbPreDelay,
  setReverbTone,
  setReverbWidth,
  type ReverbRoom,
  type SharedAudioGraph,
} from './sharedAudioGraph';

/**
 * The room the user shaped. Shared by 8D and the VR theater so there is one set
 * of controls rather than two that drift apart.
 */
export interface ReverbSettings {
  room: ReverbRoom;
  /** How much of the room you hear, 0 to 1. */
  mix: number;
  preDelayMs: number;
  /** 0 is dark, 0.5 is the room's own tone, 1 is bright. */
  tone: number;
  /** 0 collapses the tail to the centre, 1 as built, 2 past the speakers. */
  width: number;
  lowCutHz: number;
}

export const REVERB_LIMITS = {
  preDelayMs: { min: 0, max: 120 },
  width: { min: 0, max: 2 },
  lowCutHz: { min: 20, max: 400 },
} as const;

/** Full wet at mix 1. Past this the direct sound stops leading. */
const MAX_WET = 0.45;
/** Tone spans three octaves around whatever the room was designed for. */
const TONE_OCTAVES = 3;

const clamp = (v: number, lo: number, hi: number) =>
  Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo;

export function reverbToneHz(room: ReverbRoom, tone: number): number {
  return reverbRoomTone(room) * Math.pow(2, (clamp(tone, 0, 1) - 0.5) * TONE_OCTAVES);
}

export interface ReverbModulation {
  /** Scales the user's mix, for the VR seat distance. */
  mixScale?: number;
  /** Scales the user's tone, so far seats sound darker. */
  toneScale?: number;
  rampSeconds?: number;
}

export function applyReverbSettings(
  graph: SharedAudioGraph,
  settings: ReverbSettings,
  mod: ReverbModulation = {},
) {
  const ramp = mod.rampSeconds ?? 0.3;
  setReverbMix(graph, clamp(settings.mix, 0, 1) * MAX_WET * (mod.mixScale ?? 1), ramp);
  setReverbPreDelay(
    graph,
    clamp(settings.preDelayMs, REVERB_LIMITS.preDelayMs.min, REVERB_LIMITS.preDelayMs.max) / 1000,
    ramp,
  );
  setReverbTone(graph, reverbToneHz(settings.room, settings.tone) * (mod.toneScale ?? 1), ramp);
  setReverbWidth(graph, clamp(settings.width, REVERB_LIMITS.width.min, REVERB_LIMITS.width.max), ramp);
  setReverbLowCut(
    graph,
    clamp(settings.lowCutHz, REVERB_LIMITS.lowCutHz.min, REVERB_LIMITS.lowCutHz.max),
    ramp,
  );
}
