import { createContext, useContext, useRef, useState, useCallback, useMemo, useEffect, type ReactNode, type RefObject } from 'react';
import type Hls from 'hls.js';
import type { FileType } from '~/lib/types';

export interface QualityLevel {
  height: number;
  width: number;
  bitrate: number;
}

export interface ThumbnailSpriteMeta {
  duration: number;
  cols: number;
  rows: number;
  cellSize: number;
  interval: number;
  cells: { index: number; start: number; end: number }[];
}

export interface PlayerState {
  isPlaying: boolean;
  isPaused: boolean;
  isBuffering: boolean;
  isLoaded: boolean;
  hasError: boolean;
  isEnded: boolean;
  currentTime: number;
  duration: number;
  buffered: number;
  volume: number;
  isMuted: boolean;
  playbackRate: number;
  isFullscreen: boolean;
  levels: QualityLevel[];
  currentLevel: number;
  controlsVisible: boolean;
}

interface PlayerContextValue {
  videoRef: RefObject<HTMLVideoElement | null>;
  hlsRef: RefObject<Hls | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  state: PlayerState;
  setState: React.Dispatch<React.SetStateAction<PlayerState>>;

  src: string;
  file: FileType | null;
  imageID: string;
  isReel: boolean;
  loop: boolean;
  setLoop: (v: boolean) => void;
  autoPlay: boolean;
  setAutoPlay: (v: boolean) => void;

  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  setPlaybackRate: (rate: number) => void;
  setQualityLevel: (level: number) => void;
  toggleFullscreen: () => void;
  replay: () => void;
  setControlsVisible: (visible: boolean) => void;
  startInteraction: () => void;
  endInteraction: () => void;

  spriteMeta: ThumbnailSpriteMeta | null;
  spriteUrl: string | null;
  setSpriteMeta: (meta: ThumbnailSpriteMeta | null) => void;
  setSpriteUrl: (url: string | null) => void;
  waveformUrl: string | null;

  ambientMode: boolean;
  setAmbientMode: (v: boolean) => void;
  ambientColors: string[];
  setAmbientColors: (v: string[]) => void;
  stableVolume: boolean;
  setStableVolume: (v: boolean) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function usePlayerContext() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayerContext must be used within PlayerProvider');
  return ctx;
}

const STORAGE_KEYS = {
  volume: 'player-volume',
  muted: 'player-muted',
  speed: 'player-speed',
  stableVolume: 'player-stable-volume',
  quality: 'hls-quality-preference',
  loop: 'player-loop',
  autoPlay: 'player-autoplay',
} as const;

function getStoredNumber(key: string, fallback: number): number {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const v = localStorage.getItem(key);
    if (v == null) return fallback;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  } catch { return fallback; }
}

function getStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const v = localStorage.getItem(key);
    if (v == null) return fallback;
    return v === 'true';
  } catch { return fallback; }
}

const INITIAL_STATE: PlayerState = {
  isPlaying: false,
  isPaused: true,
  isBuffering: false,
  isLoaded: false,
  hasError: false,
  isEnded: false,
  currentTime: 0,
  duration: 0,
  buffered: 0,
  volume: getStoredNumber(STORAGE_KEYS.volume, 1),
  isMuted: getStoredBoolean(STORAGE_KEYS.muted, false),
  playbackRate: getStoredNumber(STORAGE_KEYS.speed, 1),
  isFullscreen: false,
  levels: [],
  currentLevel: -1,
  controlsVisible: true,
};

interface PlayerProviderProps {
  children: ReactNode;
  src: string;
  file: FileType | null;
  imageID: string;
  isReel: boolean;
  loop: boolean;
  initialMuted: boolean;
  initialAutoPlay?: boolean;
}

export function PlayerProvider({ children, src, file, imageID, isReel, loop: initialLoop, initialMuted, initialAutoPlay = false }: PlayerProviderProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PlayerState>({ ...INITIAL_STATE, isMuted: initialMuted });

  const [loop, setLoopState] = useState(() => getStoredBoolean(STORAGE_KEYS.loop, initialLoop));
  const [autoPlay, setAutoPlayState] = useState(() => getStoredBoolean(STORAGE_KEYS.autoPlay, initialAutoPlay));

  const setLoop = useCallback((v: boolean) => {
    setLoopState(v);
    try { localStorage.setItem(STORAGE_KEYS.loop, v ? 'true' : 'false'); } catch {}
  }, []);
  const setAutoPlay = useCallback((v: boolean) => {
    setAutoPlayState(v);
    try { localStorage.setItem(STORAGE_KEYS.autoPlay, v ? 'true' : 'false'); } catch {}
  }, []);


  const [spriteMeta, setSpriteMeta] = useState<ThumbnailSpriteMeta | null>(null);
  const [spriteUrl, setSpriteUrl] = useState<string | null>(null);
  const [ambientMode, setAmbientMode] = useState(false);
  const [ambientColors, setAmbientColors] = useState<string[]>([]);

  const [stableVolume, setStableVolumeState] = useState(() => getStoredBoolean(STORAGE_KEYS.stableVolume, false));
  const setStableVolume = useCallback((v: boolean) => {
    setStableVolumeState(v);
    try { localStorage.setItem(STORAGE_KEYS.stableVolume, v ? 'true' : 'false'); } catch {}
  }, []);

  const waveformUrl = useMemo(() => {
    if (!file?.thumbnails?.length) return null;
    const first = file.thumbnails[0];
    if (typeof first !== 'string') return null;
    const lastSlash = first.lastIndexOf('/');
    const prefix = lastSlash >= 0 ? first.slice(0, lastSlash + 1) : '';
    return prefix ? `/api/load/image/${prefix}waveform.png` : null;
  }, [file?.thumbnails]);

  const play = useCallback(() => {
    videoRef.current?.play().catch(() => {});
  }, []);

  const pause = useCallback(() => {
    videoRef.current?.pause();
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, []);

  const seek = useCallback((time: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(time, v.duration || 0));
  }, []);

  const setVolume = useCallback((vol: number) => {
    const v = videoRef.current;
    if (!v) return;
    const clamped = Math.max(0, Math.min(1, vol));
    v.volume = clamped;
    v.muted = clamped === 0;
    setState(s => ({ ...s, volume: clamped, isMuted: clamped === 0 }));
    try {
      localStorage.setItem(STORAGE_KEYS.volume, String(clamped));
      localStorage.setItem(STORAGE_KEYS.muted, clamped === 0 ? 'true' : 'false');
    } catch {}
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setState(s => ({ ...s, isMuted: v.muted }));
    try { localStorage.setItem(STORAGE_KEYS.muted, v.muted ? 'true' : 'false'); } catch {}
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = rate;
    setState(s => ({ ...s, playbackRate: rate }));
    try { localStorage.setItem(STORAGE_KEYS.speed, String(rate)); } catch {}
  }, []);

  const setQualityLevel = useCallback((level: number) => {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.currentLevel = level;
    setState(s => ({ ...s, currentLevel: level }));
    try {
      localStorage.setItem(STORAGE_KEYS.quality, level === -1 ? 'auto' : String(hls.levels?.[level]?.height ?? 'auto'));
    } catch {}
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {}
  }, []);

  const replay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    setState(s => ({ ...s, isEnded: false }));
    v.play().catch(() => {});
  }, []);

  const interactingRef = useRef(false);
  const controlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setControlsVisible = useCallback((visible: boolean) => {
    setState(s => ({ ...s, controlsVisible: visible }));
  }, []);

  const startInteraction = useCallback(() => {
    interactingRef.current = true;
    setState(s => ({ ...s, controlsVisible: true }));
    if (controlTimerRef.current) clearTimeout(controlTimerRef.current);
  }, []);

  const endInteraction = useCallback(() => {
    interactingRef.current = false;
  }, []);

  const value: PlayerContextValue = {
    videoRef,
    hlsRef,
    containerRef,
    state,
    setState,
    src,
    file,
    imageID,
    isReel,
    loop,
    setLoop,
    autoPlay,
    setAutoPlay,
    play,
    pause,
    togglePlay,
    seek,
    setVolume,
    toggleMute,
    setPlaybackRate,
    setQualityLevel,
    toggleFullscreen,
    replay,
    setControlsVisible,
    startInteraction,
    endInteraction,
    spriteMeta,
    spriteUrl,
    setSpriteMeta,
    setSpriteUrl,
    waveformUrl,
    ambientMode,
    setAmbientMode,
    ambientColors,
    setAmbientColors,
    stableVolume,
    setStableVolume,
  };

  return (
    <PlayerContext.Provider value={value}>
      {children}
    </PlayerContext.Provider>
  );
}
