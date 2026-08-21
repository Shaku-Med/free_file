/**
 * Client API for player settings. All reads/writes go through the server (cookies set via API).
 */

import {
  parseAudioVisualizerStyle,
  DEFAULT_AUDIO_VISUALIZER_STYLE,
} from '~/components/components/hlsplayer/audioVisualizerStyles';

export interface PlayerSettings {
  theaterMode: boolean;
  /** Desktop nav sidebar expanded (mobile sheet is not persisted). */
  sidebarOpen: boolean;
  volume: number;
  muted: boolean;
  playbackRate: number;
  stableVolume: boolean;
  loop: boolean;
  autoPlay: boolean;
  ambientMode: boolean;
  /** Blurred poster + black letterbox behind the video. Off = transparent player shell. */
  playerBackground: boolean;
  audioVisualizer: boolean;
  audioVisualizerStyle: 'ribbon' | 'bars' | 'mirror' | 'pulse' | 'line' | 'blocks' | 'dots' | 'aurora';
  visualizerConfetti: boolean;
  stemConfettiInstruments: string;
  /** Video element scale-bounces on kick/bass hits (dance mode). */
  videoBounce: boolean;
  /** Bounce strength multiplier (0.25–2, 1 = default). */
  videoBounceIntensity: number;
  ambientIntensity: number;
  /** JSON map of stem type → the bounce reacts to it. */
  videoBounceInstruments: string;
  quality: string;
  /** Preferred caption language (BCP-47). Empty string = captions off. */
  captionLanguage: string;
}

export interface PlayerSettingsPatch {
  theaterMode?: boolean;
  sidebarOpen?: boolean;
  volume?: number;
  muted?: boolean;
  playbackRate?: number;
  stableVolume?: boolean;
  loop?: boolean;
  autoPlay?: boolean;
  ambientMode?: boolean;
  playerBackground?: boolean;
  audioVisualizer?: boolean;
  audioVisualizerStyle?: string;
  visualizerConfetti?: boolean;
  stemConfettiInstruments?: string;
  videoBounce?: boolean;
  videoBounceIntensity?: number;
  ambientIntensity?: number;
  videoBounceInstruments?: string;
  quality?: string;
  captionLanguage?: string;
}

const DEFAULTS: PlayerSettings = {
  theaterMode: false,
  sidebarOpen: true,
  volume: 1,
  muted: false,
  playbackRate: 1,
  stableVolume: false,
  loop: false,
  autoPlay: false,
  ambientMode: false,
  playerBackground: true,
  audioVisualizer: false,
  audioVisualizerStyle: DEFAULT_AUDIO_VISUALIZER_STYLE,
  visualizerConfetti: true,
  stemConfettiInstruments: '{"kick":true,"snare":true,"hihat":true,"bass":true,"other":true}',
  videoBounce: false,
  videoBounceIntensity: 1,
  /** Just under the midpoint: dimmer than a full glow without going dark. */
  ambientIntensity: 0.4,
  videoBounceInstruments: '{"kick":true,"bass":true,"snare":false,"hihat":false,"other":false}',
  quality: 'auto',
  captionLanguage: '',
};

function clampAmbient(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULTS.ambientIntensity;
  return Math.max(0, Math.min(1, n));
}

function clampIntensity(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULTS.videoBounceIntensity;
  return Math.max(0.25, Math.min(2, n));
}

export async function getPlayerSettings(): Promise<PlayerSettings> {
  const res = await fetch('/api/player-settings', { credentials: 'same-origin' });
  if (!res.ok) return DEFAULTS;
  const data = await res.json();
  return {
    theaterMode: data.theaterMode === true,
    sidebarOpen: data.sidebarOpen !== false,
    volume: Number.isFinite(data.volume) ? Math.max(0, Math.min(1, data.volume)) : DEFAULTS.volume,
    muted: data.muted === true,
    playbackRate: Number.isFinite(data.playbackRate) ? data.playbackRate : DEFAULTS.playbackRate,
    stableVolume: data.stableVolume === true,
    loop: data.loop === true,
    autoPlay: data.autoPlay === true,
    ambientMode: data.ambientMode === true || data.ambientMode === '1',
    playerBackground: data.playerBackground !== false && data.playerBackground !== '0',
    audioVisualizer: data.audioVisualizer === true || data.audioVisualizer === '1',
    audioVisualizerStyle: parseAudioVisualizerStyle(
      typeof data.audioVisualizerStyle === 'string' ? data.audioVisualizerStyle : undefined
    ),
    visualizerConfetti: data.visualizerConfetti !== false && data.visualizerConfetti !== '0',
    stemConfettiInstruments:
      typeof data.stemConfettiInstruments === 'string'
        ? data.stemConfettiInstruments
        : DEFAULTS.stemConfettiInstruments,
    videoBounce: data.videoBounce === true || data.videoBounce === '1',
    videoBounceIntensity: clampIntensity(data.videoBounceIntensity),
    ambientIntensity: clampAmbient(data.ambientIntensity),
    videoBounceInstruments:
      typeof data.videoBounceInstruments === 'string'
        ? data.videoBounceInstruments
        : DEFAULTS.videoBounceInstruments,
    quality: typeof data.quality === 'string' ? data.quality : DEFAULTS.quality,
    captionLanguage: typeof data.captionLanguage === 'string' ? data.captionLanguage : DEFAULTS.captionLanguage,
  };
}

export async function setPlayerSettings(patch: PlayerSettingsPatch): Promise<void> {
  await fetch('/api/player-settings', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}
