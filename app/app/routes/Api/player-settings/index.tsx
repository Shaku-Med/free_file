/**
 * Player controls settings API: GET returns current settings from cookies,
 * POST accepts a body and sets cookies via Set-Cookie headers.
 * No auth required (UI preferences only).
 */

import {
  parseAudioVisualizerStyle,
  AUDIO_VISUALIZER_STYLES,
} from '~/components/components/hlsplayer/audioVisualizerStyles';

const COOKIE_NAMES = {
  theaterMode: 'player-theater-mode',
  sidebarOpen: 'player-sidebar-open',
  volume: 'player-volume',
  muted: 'player-muted',
  speed: 'player-speed',
  stableVolume: 'player-stable-volume',
  loop: 'player-loop',
  autoPlay: 'player-autoplay',
  ambientMode: 'player-ambient-mode',
  ambientSync: 'player-ambient-sync',
  ambientSize: 'player-ambient-size',
  playerBackground: 'player-background',
  audioVisualizer: 'player-audio-visualizer',
  audioVisualizerStyle: 'player-audio-visualizer-style',
  visualizerConfetti: 'player-visualizer-confetti',
  visualizerWave: 'player-visualizer-wave',
  stemConfettiInstruments: 'player-stem-confetti',
  videoBounce: 'player-video-bounce',
  videoBounceIntensity: 'player-video-bounce-intensity',
  ambientIntensity: 'player-ambient-intensity',
  seekWaveThumb: 'player-seek-wave-thumb',
  videoBounceInstruments: 'player-video-bounce-instruments',
  quality: 'hls-quality-preference',
  spatialAudio: 'player-spatial-audio',
  spatialAudioConfig: 'player-spatial-audio-config',
  captionLanguage: 'player-caption-language',
} as const;

const CAPTION_LANGUAGE_RE = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/;

/** Legacy shadcn sidebar cookie; used only if `player-sidebar-open` is absent. */
const LEGACY_SIDEBAR_STATE_COOKIE = 'sidebar_state';

const MAX_AGE = 365 * 24 * 60 * 60; // 1 year

function parseCookieHeader(cookieHeader: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key && value) out[key] = decodeURIComponent(value);
  }
  return out;
}

function buildSetCookie(name: string, value: string, secure: boolean): string {
  const parts = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${MAX_AGE}`,
    'SameSite=Strict',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export interface PlayerSettingsDto {
  theaterMode?: boolean;
  /** Desktop sidebar expanded (not the mobile sheet). */
  sidebarOpen?: boolean;
  volume?: number;
  muted?: boolean;
  playbackRate?: number;
  stableVolume?: boolean;
  loop?: boolean;
  autoPlay?: boolean;
  ambientMode?: boolean;
  /** Ambient glow follows the video live (no resample gap). */
  ambientSync?: boolean;
  /** Ambient glow size multiplier (1–2). */
  ambientSize?: number;
  playerBackground?: boolean;
  audioVisualizer?: boolean;
  audioVisualizerStyle?: string;
  visualizerConfetti?: boolean;
  /** The standing wave ribbon; off = bounce-only visualizer. */
  visualizerWave?: boolean;
  stemConfettiInstruments?: string;
  /** Video element scale-bounces on kick/bass hits. */
  videoBounce?: boolean;
  /** Bounce strength multiplier (0.25–2). */
  videoBounceIntensity?: number;
  ambientIntensity?: number;
  seekWaveThumb?: string;
  /** JSON map of stem type → bounce reacts to it. */
  videoBounceInstruments?: string;
  quality?: string;
  spatialAudio?: boolean;
  /** JSON-encoded SpatialAudioConfig from `useSpatialAudio`. Server validates length only  shape is checked on read. */
  spatialAudioConfig?: string;
  /** Preferred caption language (BCP-47). Empty string means captions off. */
  captionLanguage?: string;
}

function toResponse(body: unknown, status: number, setCookies: string[] = []): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  setCookies.forEach((c) => headers.append('Set-Cookie', c));
  return new Response(JSON.stringify(body), { status, headers });
}

/** Parses Cookie header and returns player settings (for use in root loader or elsewhere). */
export function getPlayerSettingsFromCookies(cookieHeader: string | null) {
  const cookies = parseCookieHeader(cookieHeader);
  const get = (name: string) => cookies[name];
  const theaterMode = get(COOKIE_NAMES.theaterMode) === 'true';
  const volumeRaw = get(COOKIE_NAMES.volume);
  const volume = volumeRaw != null ? parseFloat(volumeRaw) : 1;
  const muted = get(COOKIE_NAMES.muted) === 'true';
  const speedRaw = get(COOKIE_NAMES.speed);
  const playbackRate = speedRaw != null ? parseFloat(speedRaw) : 1;
  const stableVolume = get(COOKIE_NAMES.stableVolume) === 'true';
  const loop = get(COOKIE_NAMES.loop) === 'true';
  const autoPlay = get(COOKIE_NAMES.autoPlay) === 'true';
  const ambientMode = get(COOKIE_NAMES.ambientMode) === '1' || get(COOKIE_NAMES.ambientMode) === 'true';
  const ambientSync = get(COOKIE_NAMES.ambientSync) === '1';
  const ambientSizeRaw = parseFloat(get(COOKIE_NAMES.ambientSize) ?? '');
  const ambientSize = Number.isFinite(ambientSizeRaw)
    ? Math.max(1, Math.min(2, ambientSizeRaw))
    : 2;
  const playerBackgroundRaw = get(COOKIE_NAMES.playerBackground);
  const playerBackground = playerBackgroundRaw === '0' || playerBackgroundRaw === 'false' ? false : true;
  const audioVisualizer =
    get(COOKIE_NAMES.audioVisualizer) === '1' || get(COOKIE_NAMES.audioVisualizer) === 'true';
  const styleRaw = get(COOKIE_NAMES.audioVisualizerStyle);
  const audioVisualizerStyle = parseAudioVisualizerStyle(styleRaw);
  const confettiRaw = get(COOKIE_NAMES.visualizerConfetti);
  const visualizerConfetti = confettiRaw === '0' || confettiRaw === 'false' ? false : true;
  const waveRaw = get(COOKIE_NAMES.visualizerWave);
  const visualizerWave = waveRaw === '0' || waveRaw === 'false' ? false : true;
  const stemConfettiInstruments = get(COOKIE_NAMES.stemConfettiInstruments) ?? '';
  const bounceRaw = get(COOKIE_NAMES.videoBounce);
  const videoBounce = bounceRaw === '1' || bounceRaw === 'true';
  const bounceIntensityRaw = parseFloat(get(COOKIE_NAMES.videoBounceIntensity) ?? '');
  const videoBounceIntensity = Number.isFinite(bounceIntensityRaw)
    ? Math.max(0.25, Math.min(2, bounceIntensityRaw))
    : 1;
  const ambientIntensityRaw = parseFloat(get(COOKIE_NAMES.ambientIntensity) ?? '');
  // 0 = almost no glow, 1 = full spread. 0.4 sits just under the midpoint, which
  // is the "a bit dim" look we want out of the box.
  const ambientIntensity = Number.isFinite(ambientIntensityRaw)
    ? Math.max(0, Math.min(1, ambientIntensityRaw))
    : 0.4;
  // 'ride' = the handle sits on the waveform; 'bottom' = pinned to the rail.
  const seekWaveThumb: 'ride' | 'bottom' =
    get(COOKIE_NAMES.seekWaveThumb) === 'bottom' ? 'bottom' : 'ride';
  const videoBounceInstruments = get(COOKIE_NAMES.videoBounceInstruments) ?? '';
  const quality = get(COOKIE_NAMES.quality) ?? 'auto';
  const spatialAudio =
    get(COOKIE_NAMES.spatialAudio) === '1' || get(COOKIE_NAMES.spatialAudio) === 'true';
  const spatialAudioConfig = get(COOKIE_NAMES.spatialAudioConfig) ?? '';
  const captionLanguageRaw = get(COOKIE_NAMES.captionLanguage) ?? '';
  const captionLanguage =
    captionLanguageRaw && CAPTION_LANGUAGE_RE.test(captionLanguageRaw)
      ? captionLanguageRaw
      : '';
  const sidebarOpenRaw = get(COOKIE_NAMES.sidebarOpen);
  let sidebarOpen = true;
  if (sidebarOpenRaw === 'true') sidebarOpen = true;
  else if (sidebarOpenRaw === 'false') sidebarOpen = false;
  else {
    const legacy = cookies[LEGACY_SIDEBAR_STATE_COOKIE];
    if (legacy === 'false') sidebarOpen = false;
  }
  return {
    theaterMode,
    sidebarOpen,
    volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1,
    muted,
    playbackRate: Number.isFinite(playbackRate) ? playbackRate : 1,
    stableVolume,
    loop,
    autoPlay,
    ambientMode,
    ambientSync,
    ambientSize,
    playerBackground,
    audioVisualizer,
    audioVisualizerStyle,
    visualizerConfetti,
    visualizerWave,
    stemConfettiInstruments,
    videoBounce,
    videoBounceIntensity,
    ambientIntensity,
    seekWaveThumb,
    videoBounceInstruments,
    quality,
    spatialAudio,
    spatialAudioConfig,
    captionLanguage,
  };
}

export const loader = async ({ request }: { request: Request }) => {
  try {
    const payload = getPlayerSettingsFromCookies(request.headers.get('Cookie'));
    return toResponse(payload, 200);
  } catch (e) {
    console.error('Player settings loader error:', e);
    return toResponse({ error: 'Internal server error' }, 500);
  }
};

export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== 'POST') {
      return toResponse({ error: 'Method not allowed' }, 405);
    }

    let body: PlayerSettingsDto;
    try {
      body = await request.json();
    } catch {
      return toResponse({ error: 'Invalid JSON' }, 400);
    }

    const secure = request.url.startsWith('https');
    const setCookies: string[] = [];
    const result: PlayerSettingsDto = {};

    if (typeof body.theaterMode === 'boolean') {
      const v = body.theaterMode ? 'true' : 'false';
      setCookies.push(buildSetCookie(COOKIE_NAMES.theaterMode, v, secure));
      result.theaterMode = body.theaterMode;
    }
    if (typeof body.sidebarOpen === 'boolean') {
      const v = body.sidebarOpen ? 'true' : 'false';
      setCookies.push(buildSetCookie(COOKIE_NAMES.sidebarOpen, v, secure));
      result.sidebarOpen = body.sidebarOpen;
    }
    if (typeof body.volume === 'number') {
      const v = String(Math.max(0, Math.min(1, body.volume)));
      setCookies.push(buildSetCookie(COOKIE_NAMES.volume, v, secure));
      result.volume = parseFloat(v);
    }
    if (typeof body.muted === 'boolean') {
      const v = body.muted ? 'true' : 'false';
      setCookies.push(buildSetCookie(COOKIE_NAMES.muted, v, secure));
      result.muted = body.muted;
    }
    if (typeof body.playbackRate === 'number') {
      const v = String(body.playbackRate);
      setCookies.push(buildSetCookie(COOKIE_NAMES.speed, v, secure));
      result.playbackRate = body.playbackRate;
    }
    if (typeof body.stableVolume === 'boolean') {
      const v = body.stableVolume ? 'true' : 'false';
      setCookies.push(buildSetCookie(COOKIE_NAMES.stableVolume, v, secure));
      result.stableVolume = body.stableVolume;
    }
    if (typeof body.loop === 'boolean') {
      const v = body.loop ? 'true' : 'false';
      setCookies.push(buildSetCookie(COOKIE_NAMES.loop, v, secure));
      result.loop = body.loop;
    }
    if (typeof body.autoPlay === 'boolean') {
      const v = body.autoPlay ? 'true' : 'false';
      setCookies.push(buildSetCookie(COOKIE_NAMES.autoPlay, v, secure));
      result.autoPlay = body.autoPlay;
    }
    if (typeof body.ambientMode === 'boolean') {
      const v = body.ambientMode ? '1' : '0';
      setCookies.push(buildSetCookie(COOKIE_NAMES.ambientMode, v, secure));
      result.ambientMode = body.ambientMode;
    }
    if (typeof body.ambientSync === 'boolean') {
      const v = body.ambientSync ? '1' : '0';
      setCookies.push(buildSetCookie(COOKIE_NAMES.ambientSync, v, secure));
      result.ambientSync = body.ambientSync;
    }
    if (typeof body.ambientSize === 'number' && Number.isFinite(body.ambientSize)) {
      const v = Math.max(1, Math.min(2, body.ambientSize));
      setCookies.push(buildSetCookie(COOKIE_NAMES.ambientSize, String(v), secure));
      result.ambientSize = v;
    }
    if (typeof body.playerBackground === 'boolean') {
      const v = body.playerBackground ? '1' : '0';
      setCookies.push(buildSetCookie(COOKIE_NAMES.playerBackground, v, secure));
      result.playerBackground = body.playerBackground;
    }
    if (typeof body.audioVisualizer === 'boolean') {
      const v = body.audioVisualizer ? '1' : '0';
      setCookies.push(buildSetCookie(COOKIE_NAMES.audioVisualizer, v, secure));
      result.audioVisualizer = body.audioVisualizer;
    }
    if (typeof body.audioVisualizerStyle === 'string') {
      const trimmed = body.audioVisualizerStyle.trim();
      if ((AUDIO_VISUALIZER_STYLES as readonly string[]).includes(trimmed)) {
        setCookies.push(
          buildSetCookie(COOKIE_NAMES.audioVisualizerStyle, trimmed, secure)
        );
        result.audioVisualizerStyle = trimmed;
      }
    }
    if (typeof body.visualizerConfetti === 'boolean') {
      const v = body.visualizerConfetti ? '1' : '0';
      setCookies.push(buildSetCookie(COOKIE_NAMES.visualizerConfetti, v, secure));
      result.visualizerConfetti = body.visualizerConfetti;
    }
    if (typeof body.visualizerWave === 'boolean') {
      const v = body.visualizerWave ? '1' : '0';
      setCookies.push(buildSetCookie(COOKIE_NAMES.visualizerWave, v, secure));
      result.visualizerWave = body.visualizerWave;
    }
    if (typeof body.stemConfettiInstruments === 'string') {
      const trimmed = body.stemConfettiInstruments.slice(0, 512);
      setCookies.push(buildSetCookie(COOKIE_NAMES.stemConfettiInstruments, trimmed, secure));
      result.stemConfettiInstruments = trimmed;
    }
    if (typeof body.videoBounce === 'boolean') {
      const v = body.videoBounce ? '1' : '0';
      setCookies.push(buildSetCookie(COOKIE_NAMES.videoBounce, v, secure));
      result.videoBounce = body.videoBounce;
    }
    if (typeof body.videoBounceIntensity === 'number' && Number.isFinite(body.videoBounceIntensity)) {
      const v = Math.max(0.25, Math.min(2, body.videoBounceIntensity));
      setCookies.push(buildSetCookie(COOKIE_NAMES.videoBounceIntensity, String(v), secure));
      result.videoBounceIntensity = v;
    }
    if (typeof body.ambientIntensity === 'number' && Number.isFinite(body.ambientIntensity)) {
      const v = Math.max(0, Math.min(1, body.ambientIntensity));
      setCookies.push(buildSetCookie(COOKIE_NAMES.ambientIntensity, String(v), secure));
      result.ambientIntensity = v;
    }
    if (body.seekWaveThumb === 'ride' || body.seekWaveThumb === 'bottom') {
      setCookies.push(buildSetCookie(COOKIE_NAMES.seekWaveThumb, body.seekWaveThumb, secure));
      result.seekWaveThumb = body.seekWaveThumb;
    }
    if (typeof body.videoBounceInstruments === 'string') {
      const trimmed = body.videoBounceInstruments.slice(0, 256);
      setCookies.push(buildSetCookie(COOKIE_NAMES.videoBounceInstruments, trimmed, secure));
      result.videoBounceInstruments = trimmed;
    }
    if (typeof body.quality === 'string') {
      const v = body.quality.trim() || 'auto';
      setCookies.push(buildSetCookie(COOKIE_NAMES.quality, v, secure));
      result.quality = v;
    }
    if (typeof body.spatialAudio === 'boolean') {
      const v = body.spatialAudio ? '1' : '0';
      setCookies.push(buildSetCookie(COOKIE_NAMES.spatialAudio, v, secure));
      result.spatialAudio = body.spatialAudio;
    }
    if (typeof body.spatialAudioConfig === 'string') {
      // Cap to a sane size  shape validation lives on the client where the type exists.
      const trimmed = body.spatialAudioConfig.slice(0, 1024);
      setCookies.push(buildSetCookie(COOKIE_NAMES.spatialAudioConfig, trimmed, secure));
      result.spatialAudioConfig = trimmed;
    }
    if (typeof body.captionLanguage === 'string') {
      const trimmed = body.captionLanguage.trim();
      const value =
        trimmed === '' || CAPTION_LANGUAGE_RE.test(trimmed) ? trimmed : '';
      setCookies.push(buildSetCookie(COOKIE_NAMES.captionLanguage, value, secure));
      result.captionLanguage = value;
    }

    return toResponse({ success: true, settings: result }, 200, setCookies);
  } catch (e) {
    console.error('Player settings action error:', e);
    return toResponse({ error: 'Internal server error' }, 500);
  }
};
