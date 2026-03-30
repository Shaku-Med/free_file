/**
 * Player controls settings API: GET returns current settings from cookies,
 * POST accepts a body and sets cookies via Set-Cookie headers.
 * No auth required (UI preferences only).
 */

const COOKIE_NAMES = {
  theaterMode: 'player-theater-mode',
  volume: 'player-volume',
  muted: 'player-muted',
  speed: 'player-speed',
  stableVolume: 'player-stable-volume',
  loop: 'player-loop',
  autoPlay: 'player-autoplay',
  ambientMode: 'player-ambient-mode',
  audioVisualizer: 'player-audio-visualizer',
  audioVisualizerStyle: 'player-audio-visualizer-style',
  quality: 'hls-quality-preference',
} as const;

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
  const audioVisualizer =
    get(COOKIE_NAMES.audioVisualizer) === '1' || get(COOKIE_NAMES.audioVisualizer) === 'true';
  const styleRaw = get(COOKIE_NAMES.audioVisualizerStyle);
  const validStyles = ['scroll', 'bars', 'mirror', 'ribbon', 'pulse'] as const;
  const audioVisualizerStyle =
    styleRaw && (validStyles as readonly string[]).includes(styleRaw)
      ? (styleRaw as (typeof validStyles)[number])
      : 'scroll';
  const quality = get(COOKIE_NAMES.quality) ?? 'auto';
  return {
    theaterMode,
    volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1,
    muted,
    playbackRate: Number.isFinite(playbackRate) ? playbackRate : 1,
    stableVolume,
    loop,
    autoPlay,
    ambientMode,
    audioVisualizer,
    audioVisualizerStyle,
    quality,
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
    if (typeof body.audioVisualizer === 'boolean') {
      const v = body.audioVisualizer ? '1' : '0';
      setCookies.push(buildSetCookie(COOKIE_NAMES.audioVisualizer, v, secure));
      result.audioVisualizer = body.audioVisualizer;
    }
    if (typeof body.audioVisualizerStyle === 'string') {
      const trimmed = body.audioVisualizerStyle.trim();
      const validStyles = ['scroll', 'bars', 'mirror', 'ribbon', 'pulse'] as const;
      if ((validStyles as readonly string[]).includes(trimmed)) {
        setCookies.push(
          buildSetCookie(COOKIE_NAMES.audioVisualizerStyle, trimmed, secure)
        );
        result.audioVisualizerStyle = trimmed;
      }
    }
    if (typeof body.quality === 'string') {
      const v = body.quality.trim() || 'auto';
      setCookies.push(buildSetCookie(COOKIE_NAMES.quality, v, secure));
      result.quality = v;
    }

    return toResponse({ success: true, settings: result }, 200, setCookies);
  } catch (e) {
    console.error('Player settings action error:', e);
    return toResponse({ error: 'Internal server error' }, 500);
  }
};
