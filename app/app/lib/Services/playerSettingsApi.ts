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
  audioVisualizer: boolean;
  audioVisualizerStyle: 'scroll' | 'bars' | 'mirror' | 'ribbon' | 'pulse';
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
  audioVisualizer?: boolean;
  audioVisualizerStyle?: string;
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
  audioVisualizer: false,
  audioVisualizerStyle: DEFAULT_AUDIO_VISUALIZER_STYLE,
  quality: 'auto',
  captionLanguage: '',
};

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
    audioVisualizer: data.audioVisualizer === true || data.audioVisualizer === '1',
    audioVisualizerStyle: parseAudioVisualizerStyle(
      typeof data.audioVisualizerStyle === 'string' ? data.audioVisualizerStyle : undefined
    ),
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
