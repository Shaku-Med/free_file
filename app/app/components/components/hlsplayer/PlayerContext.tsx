import { createContext, useContext, useRef, useState, useCallback, useMemo, useEffect, type ReactNode, type RefObject } from 'react';
import type Hls from 'hls.js';
import type { FileType } from '~/lib/types';
import { isMobile } from 'react-device-detect';
import { useFileContext } from '~/lib/Context/Context';
import { getWaveformImagePathPrefix } from '~/lib/utils';
import {
  type AudioVisualizerStyle,
  DEFAULT_AUDIO_VISUALIZER_STYLE,
} from './audioVisualizerStyles';

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
  cellWidth?: number;
  cellHeight?: number;
  interval: number;
  cells: { index: number; start: number; end: number }[];
}

export interface BufferedRange {
  start: number;
  end: number;
}

export interface SubtitleTrack {
  id: number;
  label: string;
  lang: string;
  kind: string;
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
  bufferedRanges: BufferedRange[];
  volume: number;
  isMuted: boolean;
  playbackRate: number;
  isFullscreen: boolean;
  levels: QualityLevel[];
  currentLevel: number;
  controlsVisible: boolean;
  subtitleTracks: SubtitleTrack[];
  currentSubtitleTrack: number;
}

interface PlayerContextValue {
  hlsRef: RefObject<Hls | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
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
  audioVisualizer: boolean;
  setAudioVisualizer: (v: boolean) => void;
  audioVisualizerStyle: AudioVisualizerStyle;
  setAudioVisualizerStyle: (v: AudioVisualizerStyle) => void;
  /** Session-only debug overlay (not persisted). */
  statsForNerds: boolean;
  setStatsForNerds: (v: boolean) => void;
  startTime?: number;
  setSubtitleTrack: (id: number) => void;
  /** When false (e.g. signed-out watch page), ambient, visualizer, and up-next controls are disabled in UI. */
  authPlaybackFeatures: boolean;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function usePlayerContext() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayerContext must be used within PlayerProvider');
  return ctx;
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
  bufferedRanges: [],
  volume: 1,
  isMuted: false,
  playbackRate: 1,
  isFullscreen: false,
  levels: [],
  currentLevel: -1,
  controlsVisible: true,
  subtitleTracks: [],
  currentSubtitleTrack: -1,
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
  videoRef: React.RefObject<HTMLVideoElement | null>;
  startTime?: number;
  /** Default true. Set false on watch page for signed-out users. */
  authPlaybackFeatures?: boolean;
}

export function PlayerProvider({
  children,
  src,
  file,
  imageID,
  isReel,
  loop: initialLoop,
  initialMuted,
  initialAutoPlay = false,
  videoRef,
  startTime,
  authPlaybackFeatures = true,
}: PlayerProviderProps) {
  const { playerSettings, setPlayerSettings, savePlayerSettings } = useFileContext();
  const hlsRef = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PlayerState>({ ...INITIAL_STATE, isMuted: initialMuted });
  const appliedInitialRef = useRef(false);

  const [loop, setLoopState] = useState(initialLoop);
  const [autoPlay, setAutoPlayState] = useState(initialAutoPlay);

  const setLoop = useCallback((v: boolean) => {
    setLoopState(v);
    setPlayerSettings(prev => (prev ? { ...prev, loop: v } : prev));
    savePlayerSettings({ loop: v }).catch(() => {});
  }, [setPlayerSettings, savePlayerSettings]);
  const setAutoPlay = useCallback(
    (v: boolean) => {
      if (!authPlaybackFeatures) return;
      setAutoPlayState(v);
      setPlayerSettings(prev => (prev ? { ...prev, autoPlay: v } : prev));
      savePlayerSettings({ autoPlay: v }).catch(() => {});
    },
    [authPlaybackFeatures, setPlayerSettings, savePlayerSettings]
  );

  const [spriteMeta, setSpriteMeta] = useState<ThumbnailSpriteMeta | null>(null);
  const [spriteUrl, setSpriteUrl] = useState<string | null>(null);
  const [ambientModeState, setAmbientModeState] = useState(false);
  const [ambientColors, setAmbientColors] = useState<string[]>([]);

  const [stableVolume, setStableVolumeState] = useState(false);
  const setStableVolume = useCallback((v: boolean) => {
    setStableVolumeState(v);
    setPlayerSettings(prev => (prev ? { ...prev, stableVolume: v } : prev));
    savePlayerSettings({ stableVolume: v }).catch(() => {});
  }, [setPlayerSettings, savePlayerSettings]);

  const [audioVisualizer, setAudioVisualizerState] = useState(false);
  const audioVisualizerStyleRef = useRef<AudioVisualizerStyle>(DEFAULT_AUDIO_VISUALIZER_STYLE);
  const setAudioVisualizer = useCallback(
    (v: boolean) => {
      if (!authPlaybackFeatures) return;
      setAudioVisualizerState(v);
      setPlayerSettings(prev => (prev ? { ...prev, audioVisualizer: v } : prev));
      savePlayerSettings({
        audioVisualizer: v,
        audioVisualizerStyle: audioVisualizerStyleRef.current,
      }).catch(() => {});
    },
    [authPlaybackFeatures, setPlayerSettings, savePlayerSettings]
  );

  const [audioVisualizerStyle, setAudioVisualizerStyleState] = useState<AudioVisualizerStyle>(
    DEFAULT_AUDIO_VISUALIZER_STYLE
  );
  const [statsForNerds, setStatsForNerds] = useState(false);
  const setAudioVisualizerStyle = useCallback(
    (style: AudioVisualizerStyle) => {
      if (!authPlaybackFeatures) return;
      audioVisualizerStyleRef.current = style;
      setAudioVisualizerStyleState(style);
      setPlayerSettings(prev => (prev ? { ...prev, audioVisualizerStyle: style } : prev));
      savePlayerSettings({ audioVisualizerStyle: style }).catch(() => {});
    },
    [authPlaybackFeatures, setPlayerSettings, savePlayerSettings]
  );

  useEffect(() => {
    if (!playerSettings || appliedInitialRef.current) return;
    appliedInitialRef.current = true;
    setState(s => ({
      ...s,
      volume: playerSettings.volume,
      isMuted: playerSettings.muted,
      playbackRate: playerSettings.playbackRate,
    }));
    setLoopState(playerSettings.loop);
    setAutoPlayState(playerSettings.autoPlay);
    setStableVolumeState(playerSettings.stableVolume);
    if (authPlaybackFeatures) {
      setAudioVisualizerState(playerSettings.audioVisualizer ?? false);
      const style = playerSettings.audioVisualizerStyle ?? DEFAULT_AUDIO_VISUALIZER_STYLE;
      audioVisualizerStyleRef.current = style;
      setAudioVisualizerStyleState(style);
      setAmbientModeState(playerSettings.ambientMode);
    } else {
      setAudioVisualizerState(false);
      audioVisualizerStyleRef.current = DEFAULT_AUDIO_VISUALIZER_STYLE;
      setAudioVisualizerStyleState(DEFAULT_AUDIO_VISUALIZER_STYLE);
      setAmbientModeState(false);
    }
    const v = videoRef.current;
    if (v) {
      // Don't touch the video element while AirPlay / Chromecast is active —
      // changing volume, muted, or playbackRate can interrupt the remote session.
      const isRemote =
        (v as any).webkitCurrentPlaybackTargetIsWireless ||
        (v as any).remote?.state === 'connected';
      if (!isRemote) {
        v.volume = playerSettings.volume;
        v.muted = playerSettings.muted;
        v.playbackRate = playerSettings.playbackRate;
      }
    }
  }, [playerSettings, videoRef, authPlaybackFeatures]);

  useEffect(() => {
    if (authPlaybackFeatures) return;
    setAmbientModeState(false);
    setAudioVisualizerState(false);
  }, [authPlaybackFeatures]);

  const waveformUrl = useMemo(() => {
    if (!file) return null;
    const prefix = getWaveformImagePathPrefix({
      default_thumbnail: file.default_thumbnail,
      thumbnails: file.thumbnails,
      endpoint: file.endpoint,
      file_type: file.file_type,
    });
    return prefix ? `/api/load/image/${prefix}waveform.png` : null;
  }, [file?.id, file?.default_thumbnail, file?.thumbnails, file?.endpoint, file?.file_type]);

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
    // Volume is not persisted (no API/cookies) to avoid flooding on slider drag
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setState(s => ({ ...s, isMuted: v.muted }));
    // Muted is not persisted (no API/cookies) for volume slider flow
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = rate;
    setState(s => ({ ...s, playbackRate: rate }));
    setPlayerSettings(prev => (prev ? { ...prev, playbackRate: rate } : prev));
    savePlayerSettings({ playbackRate: rate }).catch(() => {});
  }, [setPlayerSettings, savePlayerSettings]);

  const setQualityLevel = useCallback((level: number) => {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.currentLevel = level;
    setState(s => ({ ...s, currentLevel: level }));
    const quality = level === -1 ? 'auto' : String(hls.levels?.[level]?.height ?? 'auto');
    setPlayerSettings(prev => (prev ? { ...prev, quality } : prev));
    savePlayerSettings({ quality }).catch(() => {});
  }, [setPlayerSettings, savePlayerSettings]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      const is_mobile = isMobile
      const el = is_mobile ? videoRef.current : containerRef.current;
      if (el) {
        if (is_mobile){
          const v = videoRef.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
          if (typeof v.webkitEnterFullscreen === 'function') {
            v.webkitEnterFullscreen();
          }
          else {
            el.requestFullscreen()
          }
        }
        else {
          await el.requestFullscreen()
        }
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

  const setSubtitleTrack = useCallback((id: number) => {
    const hls = hlsRef.current;
    if (hls) {
      hls.subtitleTrack = id;
      hls.subtitleDisplay = id !== -1;
    }
    setState(s => ({ ...s, currentSubtitleTrack: id }));
  }, []);

  const setAmbientMode = useCallback(
    (v: boolean) => {
      if (!authPlaybackFeatures) return;
      setAmbientModeState(v);
      setPlayerSettings(prev => (prev ? { ...prev, ambientMode: v } : prev));
      savePlayerSettings({ ambientMode: v }).catch(() => {});
    },
    [authPlaybackFeatures, setPlayerSettings, savePlayerSettings]
  );

  const value: PlayerContextValue = {
    hlsRef,
    containerRef,
    videoRef,
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
    ambientMode: ambientModeState,
    setAmbientMode,
    ambientColors,
    setAmbientColors,
    stableVolume,
    setStableVolume,
    audioVisualizer,
    setAudioVisualizer,
    audioVisualizerStyle,
    setAudioVisualizerStyle,
    statsForNerds,
    setStatsForNerds,
    startTime,
    setSubtitleTrack,
    authPlaybackFeatures,
  };

  return (
    <PlayerContext.Provider value={value}>
      {children}
    </PlayerContext.Provider>
  );
}
