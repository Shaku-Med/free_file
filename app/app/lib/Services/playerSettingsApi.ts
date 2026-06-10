/**
 * Client API for player settings. All reads/writes go through the server (cookies set via API).
 */

import {
  parseAudioVisualizerStyle,
  DEFAULT_AUDIO_VISUALIZER_STYLE,
} from '~/components/components/hlsplayer/audioVisualizerStyles';
import {
  parseConfettiAmount,
  parseConfettiSpread,
  parseConfettiStyle,
  DEFAULT_CONFETTI_AMOUNT,
  DEFAULT_CONFETTI_SPREAD,
  DEFAULT_CONFETTI_STYLE,
  type ConfettiAmount,
  type ConfettiSpread,
  type ConfettiStyle,
} from '~/components/components/hlsplayer/confettiSettings';

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
  audioVisualizerStyle: 'bars' | 'mirror' | 'ribbon' | 'pulse';
  visualizerConfetti: boolean;
  visualizerConfettiStyle: ConfettiStyle;
  visualizerConfettiAmount: ConfettiAmount;
  visualizerConfettiSpread: ConfettiSpread;
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
  visualizerConfetti?: boolean;
  visualizerConfettiStyle?: string;
  visualizerConfettiAmount?: string;
  visualizerConfettiSpread?: string;
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
  visualizerConfetti: true,
  visualizerConfettiStyle: DEFAULT_CONFETTI_STYLE,
  visualizerConfettiAmount: DEFAULT_CONFETTI_AMOUNT,
  visualizerConfettiSpread: DEFAULT_CONFETTI_SPREAD,
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
    visualizerConfetti: data.visualizerConfetti !== false && data.visualizerConfetti !== '0',
    visualizerConfettiStyle: parseConfettiStyle(
      typeof data.visualizerConfettiStyle === 'string' ? data.visualizerConfettiStyle : undefined
    ),
    visualizerConfettiAmount: parseConfettiAmount(
      typeof data.visualizerConfettiAmount === 'string' ? data.visualizerConfettiAmount : undefined
    ),
    visualizerConfettiSpread: parseConfettiSpread(
      typeof data.visualizerConfettiSpread === 'string' ? data.visualizerConfettiSpread : undefined
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
