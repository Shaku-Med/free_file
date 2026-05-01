import { createContext, useContext, useRef, useState, useCallback, useMemo, useEffect, type ReactNode, type RefObject } from 'react';
import type Hls from 'hls.js';
import type { FileType } from '~/lib/types';
import { isMobile } from 'react-device-detect';
import { useFileContext } from '~/lib/Context/Context';
import {
  usePictureInPictureContext,
  restoreVideoAudioAfterSystemPip,
} from '~/lib/Context/PictureInPictureContext';
import { getWaveformImagePathPrefix } from '~/lib/utils';
import {
  type AudioVisualizerStyle,
  DEFAULT_AUDIO_VISUALIZER_STYLE,
} from './audioVisualizerStyles';
import {
  DEFAULT_SPATIAL_CONFIG,
  type SpatialAudioConfig,
} from './hooks/useSpatialAudio';

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
  /** When false, reel feed embed hides play/volume/settings but keeps seek visible. */
  reelAuxiliaryChromeVisible: boolean;
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
  setReelAuxiliaryChromeVisible: (visible: boolean) => void;
  /** True when `showFeedPlayerControls && isReel` — idle timer hides all but seek. */
  reelEmbedAutoHide: boolean;
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
  /** 8D / spatial audio config (live — drives the panner). */
  spatialAudio: SpatialAudioConfig;
  setSpatialAudio: (next: SpatialAudioConfig) => void;
  spatialAudioDialogOpen: boolean;
  setSpatialAudioDialogOpen: (v: boolean) => void;
  startTime?: number;
  setSubtitleTrack: (id: number) => void;
  /** When false (e.g. signed-out watch page), ambient, visualizer, and up-next controls are disabled in UI. */
  authPlaybackFeatures: boolean;
  /**
   * Document PiP vertical reel: keep audio unmuted — don't apply global saved mute, and don't
   * force-mute inactive swiper slides via useAutoplay.
   */
  unlockPipReelAudio: boolean;
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
  reelAuxiliaryChromeVisible: true,
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
  /** Reel + feed embed: auto-hide play/volume/etc.; seek bar stays. */
  reelEmbedAutoHide?: boolean;
  /** PiP iframe reel — avoid global mute + inactive-slide forced mute (see useAutoplay). */
  unlockPipReelAudio?: boolean;
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
  reelEmbedAutoHide = false,
  unlockPipReelAudio = false,
}: PlayerProviderProps) {
  const { playerSettings, setPlayerSettings, savePlayerSettings } = useFileContext();
  const { isContentInPip } = usePictureInPictureContext();
  const hlsRef = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PlayerState>({
    ...INITIAL_STATE,
    isMuted: unlockPipReelAudio ? false : initialMuted,
  });
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
  const [spatialAudio, setSpatialAudioState] = useState<SpatialAudioConfig>(DEFAULT_SPATIAL_CONFIG);
  const [spatialAudioDialogOpen, setSpatialAudioDialogOpen] = useState(false);
  const setSpatialAudio = useCallback(
    (next: SpatialAudioConfig) => {
      setSpatialAudioState(next);
      setPlayerSettings((prev) =>
        prev
          ? { ...prev, spatialAudio: next.enabled, spatialAudioConfig: JSON.stringify(next) }
          : prev,
      );
      savePlayerSettings({
        spatialAudio: next.enabled,
        spatialAudioConfig: JSON.stringify(next),
      }).catch(() => {});
    },
    [setPlayerSettings, savePlayerSettings],
  );
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
      isMuted: unlockPipReelAudio ? false : playerSettings.muted,
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

    /** Spatial audio: parse stored config; fall back to defaults if cookie is empty/corrupt. */
    let parsed: SpatialAudioConfig = DEFAULT_SPATIAL_CONFIG;
    if (playerSettings.spatialAudioConfig) {
      try {
        const raw = JSON.parse(playerSettings.spatialAudioConfig) as Partial<SpatialAudioConfig>;
        parsed = {
          enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_SPATIAL_CONFIG.enabled,
          mode:
            raw.mode === 'manual' ||
            raw.mode === 'room-front' ||
            raw.mode === 'orbit-horizontal' ||
            raw.mode === 'orbit-vertical' ||
            raw.mode === 'figure8'
              ? raw.mode
              : DEFAULT_SPATIAL_CONFIG.mode,
          position: {
            x: Number.isFinite(raw.position?.x) ? Number(raw.position!.x) : 0,
            y: Number.isFinite(raw.position?.y) ? Number(raw.position!.y) : 0,
            z: Number.isFinite(raw.position?.z) ? Number(raw.position!.z) : -1,
          },
          radius: Number.isFinite(raw.radius) ? Math.max(0.1, Math.min(5, Number(raw.radius))) : DEFAULT_SPATIAL_CONFIG.radius,
          speedHz: Number.isFinite(raw.speedHz) ? Math.max(0.02, Math.min(2, Number(raw.speedHz))) : DEFAULT_SPATIAL_CONFIG.speedHz,
        };
      } catch {
        /* keep defaults */
      }
    }
    // Master toggle wins over the JSON field if they ever disagree (cookie tampering).
    parsed.enabled = parsed.enabled && playerSettings.spatialAudio === true;
    setSpatialAudioState(parsed);
    const v = videoRef.current;
    if (v) {
      // Don't touch the video element while AirPlay / Chromecast is active —
      // changing volume, muted, or playbackRate can interrupt the remote session.
      const isRemote =
        (v as any).webkitCurrentPlaybackTargetIsWireless ||
        (v as any).remote?.state === 'connected';
      if (!isRemote) {
        v.volume = playerSettings.volume;
        v.muted = unlockPipReelAudio ? false : playerSettings.muted;
        v.playbackRate = playerSettings.playbackRate;
      }
    }
  }, [playerSettings, videoRef, authPlaybackFeatures, unlockPipReelAudio]);

  useEffect(() => {
    if (authPlaybackFeatures) return;
    setAmbientModeState(false);
    setAudioVisualizerState(false);
  }, [authPlaybackFeatures]);

  /** System PiP (especially iOS) can set `video.muted` after enter; keep element in sync with player UI. */
  useEffect(() => {
    if (!isContentInPip(imageID)) return;
    const v = videoRef.current;
    if (!v) return;
    const isRemote =
      (v as any).webkitCurrentPlaybackTargetIsWireless ||
      (v as any).remote?.state === 'connected';
    if (isRemote) return;

    const wantSound = !state.isMuted && state.volume > 0;
    if (!wantSound) return;

    restoreVideoAudioAfterSystemPip(v, true);

    const onVolumeChange = () => {
      if (!wantSound) return;
      const el = videoRef.current;
      if (!el || !isContentInPip(imageID)) return;
      if (el.muted) {
        el.muted = false;
        if (el.volume === 0) el.volume = Math.max(state.volume, 0.01);
      }
    };

    v.addEventListener('volumechange', onVolumeChange);
    return () => v.removeEventListener('volumechange', onVolumeChange);
  }, [isContentInPip, imageID, state.isMuted, state.volume, videoRef]);

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

  const setReelAuxiliaryChromeVisible = useCallback((visible: boolean) => {
    setState(s => ({ ...s, reelAuxiliaryChromeVisible: visible }));
  }, []);

  const startInteraction = useCallback(() => {
    interactingRef.current = true;
    setState(s => ({
      ...s,
      controlsVisible: true,
      ...(reelEmbedAutoHide ? { reelAuxiliaryChromeVisible: true } : {}),
    }));
    if (controlTimerRef.current) clearTimeout(controlTimerRef.current);
  }, [reelEmbedAutoHide]);

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

  /**
   * Sync native `<video>` state changes back into our UI state.
   * Some browser UI / context-menu actions (like “Loop”) mutate element properties directly
   * without going through our controls.
   */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    let cancelled = false;
    let iv: ReturnType<typeof setInterval> | null = null;

    const isRemote =
      (v as any).webkitCurrentPlaybackTargetIsWireless ||
      (v as any).remote?.state === 'connected';
    if (isRemote) return;

    const syncOnce = () => {
      if (cancelled) return;
      const el = videoRef.current;
      if (!el) return;

      // Loop: must be polled (no dedicated event when toggled via context menu).
      if (el.loop !== loop) {
        setLoopState(el.loop);
        setPlayerSettings(prev => (prev ? { ...prev, loop: el.loop } : prev));
        savePlayerSettings({ loop: el.loop }).catch(() => {});
      }

      // Muted/volume: keep UI in sync (do not persist volume here).
      setState(s => {
        const nextMuted = Boolean(el.muted);
        const nextVol = Number.isFinite(el.volume) ? Math.max(0, Math.min(1, el.volume)) : s.volume;
        if (s.isMuted === nextMuted && s.volume === nextVol) return s;
        return { ...s, isMuted: nextMuted, volume: nextVol };
      });

      // Playback rate: some browsers allow changing this via native UI.
      if (Number.isFinite(el.playbackRate) && el.playbackRate !== state.playbackRate) {
        const rate = el.playbackRate;
        setState(s => (s.playbackRate === rate ? s : { ...s, playbackRate: rate }));
        setPlayerSettings(prev => (prev ? { ...prev, playbackRate: rate } : prev));
        savePlayerSettings({ playbackRate: rate }).catch(() => {});
      }
    };

    const onVolume = () => syncOnce();
    const onRate = () => syncOnce();
    const onLoaded = () => syncOnce();

    v.addEventListener('volumechange', onVolume);
    v.addEventListener('ratechange', onRate);
    v.addEventListener('loadedmetadata', onLoaded);

    // Poll loop + any direct property edits.
    iv = setInterval(syncOnce, 750);
    syncOnce();

    return () => {
      cancelled = true;
      v.removeEventListener('volumechange', onVolume);
      v.removeEventListener('ratechange', onRate);
      v.removeEventListener('loadedmetadata', onLoaded);
      if (iv) clearInterval(iv);
    };
    // Intentionally include `loop`/`state.playbackRate` so we compare against the latest UI.
  }, [videoRef, loop, state.playbackRate, setPlayerSettings, savePlayerSettings]);

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
    setReelAuxiliaryChromeVisible,
    reelEmbedAutoHide,
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
    spatialAudio,
    setSpatialAudio,
    spatialAudioDialogOpen,
    setSpatialAudioDialogOpen,
    startTime,
    setSubtitleTrack,
    authPlaybackFeatures,
    unlockPipReelAudio,
  };

  return (
    <PlayerContext.Provider value={value}>
      {children}
    </PlayerContext.Provider>
  );
}
