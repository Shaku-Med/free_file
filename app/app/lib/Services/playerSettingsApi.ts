/**
 * Client API for player settings. All reads/writes go through the server (cookies set via API).
 */

import {
  parseAudioVisualizerStyle,
  DEFAULT_AUDIO_VISUALIZER_STYLE,
} from '~/components/components/hlsplayer/audioVisualizerStyles';

export interface PlayerSettings {
  theaterMode: boolean;
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
}

export interface PlayerSettingsPatch {
  theaterMode?: boolean;
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
}

const DEFAULTS: PlayerSettings = {
  theaterMode: false,
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
};

export async function getPlayerSettings(): Promise<PlayerSettings> {
  const res = await fetch('/api/player-settings', { credentials: 'same-origin' });
  if (!res.ok) return DEFAULTS;
  const data = await res.json();
  return {
    theaterMode: data.theaterMode === true,
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
