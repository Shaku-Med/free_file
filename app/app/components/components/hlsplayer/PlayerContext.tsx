import { createContext, useContext, useRef, useState, useCallback, useMemo, useEffect, type ReactNode, type RefObject } from 'react';
import type Hls from 'hls.js';
import type { FileType } from '~/lib/types';
import { useFileContext } from '~/lib/Context/Context';
import {
  usePictureInPictureContext,
  restoreVideoAudioAfterSystemPip,
} from '~/lib/Context/PictureInPictureContext';
import { getWaveformImagePathPrefix } from '~/lib/utils';
import { reelChromeStore } from './reelChromeStore';
import {
  type AudioVisualizerStyle,
  DEFAULT_AUDIO_VISUALIZER_STYLE,
} from './audioVisualizerStyles';
import {
  DEFAULT_SPATIAL_CONFIG,
  type SpatialAudioConfig,
  type SpatialAudioMode,
} from './hooks/useSpatialAudio';
import { useStableVolume } from './hooks/useStableVolume';
import { enterPlayerFullscreen, syncNativeVideoControls } from './fullscreenMode';
import { windappFullscreenBridge } from '~/lib/hooks/useWindapp';
import { fetchAudioStems, type AudioStems, type StemType } from './audioStems';
import {
  DEFAULT_STEM_CONFETTI_INSTRUMENTS,
  DEFAULT_VIDEO_BOUNCE_INSTRUMENTS,
  parseStemConfettiInstruments,
  parseStemInstrumentMap,
  serializeStemConfettiInstruments,
  type StemConfettiInstruments,
} from './stemConfettiSettings';

export const SLEEP_TIMER_OPTIONS = [
  'Off',
  '5 min',
  '10 min',
  '15 min',
  '30 min',
  '45 min',
  '1 hour',
  'End of video',
] as const;
export type SleepTimerOption = (typeof SLEEP_TIMER_OPTIONS)[number];

function sleepTimerMs(opt: SleepTimerOption): number | null {
  switch (opt) {
    case '5 min':
      return 5 * 60_000;
    case '10 min':
      return 10 * 60_000;
    case '15 min':
      return 15 * 60_000;
    case '30 min':
      return 30 * 60_000;
    case '45 min':
      return 45 * 60_000;
    case '1 hour':
      return 60 * 60_000;
    default:
      return null;
  }
}

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
  /** True when `showFeedPlayerControls && isReel`  idle timer hides all but seek. */
  reelEmbedAutoHide: boolean;
  /** Measured height of the bottom control strip (px) for reel info overlay clearance. */
  reelChromeBottomReservePx: number;
  setReelChromeBottomReservePx: (px: number) => void;
  startInteraction: () => void;
  endInteraction: () => void;

  spriteMeta: ThumbnailSpriteMeta | null;
  spriteUrl: string | null;
  setSpriteMeta: (meta: ThumbnailSpriteMeta | null) => void;
  setSpriteUrl: (url: string | null) => void;
  /** Preferred waveform  JSON peaks rendered client-side. May 404 for
   *  old uploads (which only have the PNG). The SeekBar tries this first
   *  and falls back to waveformPngUrl below. */
  waveformUrl: string | null;
  /** Legacy PNG waveform  used when the JSON doesn't exist. Rendered
   *  ABOVE the normal thin seekbar as decoration. */
  waveformPngUrl: string | null;
  /** Server-analyzed kick/instrument onsets (audio_stems.json). May 404
   *  for old uploads  consumers fall back to live analyser detection. */
  audioStemsUrl: string | null;
  /** Parsed stems when audio_stems.json exists for this file. */
  audioStems: AudioStems | null;
  audioStemsAvailable: boolean;
  /** Per-instrument confetti toggles (only applies when audioStems is set). */
  stemConfettiInstruments: StemConfettiInstruments;
  setStemConfettiInstrument: (type: StemType, enabled: boolean) => void;

  ambientMode: boolean;
  setAmbientMode: (v: boolean) => void;
  /** Ambient glow follows the video live (no resample gap). */
  ambientSync: boolean;
  setAmbientSync: (v: boolean) => void;
  /** Ambient glow size multiplier (1–2). */
  ambientSize: number;
  setAmbientSize: (v: number) => void;
  /** Blurred poster + black letterbox behind the video. Off = transparent player shell. */
  playerBackground: boolean;
  setPlayerBackground: (v: boolean) => void;
  stableVolume: boolean;
  setStableVolume: (v: boolean) => void;
  audioVisualizer: boolean;
  setAudioVisualizer: (v: boolean) => void;
  audioVisualizerStyle: AudioVisualizerStyle;
  setAudioVisualizerStyle: (v: AudioVisualizerStyle) => void;
  visualizerConfetti: boolean;
  setVisualizerConfetti: (v: boolean) => void;
  /** The standing wave ribbon under the player. Off = bounce-only visualizer. */
  visualizerWave: boolean;
  setVisualizerWave: (v: boolean) => void;
  /** Video element scale-bounces on kick/bass hits (dance mode). */
  videoBounce: boolean;
  setVideoBounce: (v: boolean) => void;
  /** Bounce strength multiplier (0.25–2, 1 = default). */
  videoBounceIntensity: number;
  setVideoBounceIntensity: (v: number) => void;
  /** 0 = barely any glow, 1 = full spread. Drives the ambient opacity + mask. */
  ambientIntensity: number;
  setAmbientIntensity: (v: number) => void;
  /** Which stems the bounce reacts to. */
  videoBounceInstruments: StemConfettiInstruments;
  setVideoBounceInstrument: (type: StemType, enabled: boolean) => void;
  /** Session-only debug overlay (not persisted). */
  statsForNerds: boolean;
  setStatsForNerds: (v: boolean) => void;
  /** VR theater (three.js room around the video). Session-only  WebGL is too heavy to silently resume. */
  vrTheater: boolean;
  setVrTheater: (v: boolean) => void;
  /** Picked seat in the VR theater, "row-col" (rows front→back, cols left→right). */
  vrSeat: string;
  setVrSeat: (v: string) => void;
  /** Theater sound system: seat-positioned audio + room reverb. */
  vrSoundSystem: boolean;
  setVrSoundSystem: (v: boolean) => void;
  /** Immersive: top/bottom paper fold; camera at centre, drag to look. */
  vrImmersive: boolean;
  setVrImmersive: (v: boolean) => void;
  /** Sleep timer  pause the video after a chosen duration. `'Off'` = disabled. */
  sleepTimer: SleepTimerOption;
  setSleepTimer: (v: SleepTimerOption) => void;
  /** Epoch ms when the active timer will fire; null when off / 'End of video'. */
  sleepTimerEndsAt: number | null;
  /** 8D / spatial audio config (live  drives the panner). */
  spatialAudio: SpatialAudioConfig;
  setSpatialAudio: (next: SpatialAudioConfig) => void;
  spatialAudioDialogOpen: boolean;
  setSpatialAudioDialogOpen: (v: boolean) => void;
  startTime?: number;
  setSubtitleTrack: (id: number) => void;
  /** When false (e.g. signed-out watch page), ambient, visualizer, and up-next controls are disabled in UI. */
  authPlaybackFeatures: boolean;
  /**
   * Document PiP vertical reel: keep audio unmuted  don't apply global saved mute, and don't
   * force-mute inactive swiper slides via useAutoplay.
   */
  unlockPipReelAudio: boolean;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

/** Session-scoped VR prefs  remembered across player remounts, gone on reload. */
const vrSessionPrefs = { theater: false, seat: '1-2', sound: false, immersive: false };

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
  /** PiP iframe reel  avoid global mute + inactive-slide forced mute (see useAutoplay). */
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
    // Reels start with chrome hidden, inheriting the shared value so scrolling
    // to a new reel never flashes controls.
    reelAuxiliaryChromeVisible: reelEmbedAutoHide
      ? reelChromeStore.get()
      : INITIAL_STATE.reelAuxiliaryChromeVisible,
  });
  const appliedInitialRef = useRef(false);

  const [loop, setLoopState] = useState(isReel ? true : initialLoop);
  const [autoPlay, setAutoPlayState] = useState(initialAutoPlay);
  const [reelChromeBottomReservePx, setReelChromeBottomReservePx] = useState(0);

  const setLoop = useCallback((v: boolean) => {
    if (isReel) return;
    setLoopState(v);
    setPlayerSettings(prev => (prev ? { ...prev, loop: v } : prev));
    savePlayerSettings({ loop: v }).catch(() => {});
  }, [isReel, setPlayerSettings, savePlayerSettings]);
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

  /**
   * Thumbnail sprite is per-file. When the player swaps to a different video, clear
   * the previous file's sprite immediately so SeekBar's hover preview doesn't show
   * stale thumbnails until the new sprite finishes fetching (or stay blank if the
   * new file has no sprite at all).
   */
  const fileSpriteKey = file?.unique_id || file?.id || null;
  useEffect(() => {
    setSpriteMeta(null);
    setSpriteUrl(null);
  }, [fileSpriteKey]);

  /** End-card / watch→watch: clear ended overlay state when the file changes. */
  useEffect(() => {
    setState((s) => ({ ...s, isEnded: false, hasError: false }));
  }, [fileSpriteKey]);
  const [ambientModeState, setAmbientModeState] = useState(false);
  const [ambientSyncState, setAmbientSyncState] = useState(false);
  const [ambientSizeState, setAmbientSizeState] = useState(2);
  const [playerBackgroundState, setPlayerBackgroundState] = useState(true);

  const [stableVolume, setStableVolumeState] = useState(false);
  const setStableVolume = useCallback((v: boolean) => {
    setStableVolumeState(v);
    setPlayerSettings(prev => (prev ? { ...prev, stableVolume: v } : prev));
    savePlayerSettings({ stableVolume: v }).catch(() => {});
  }, [setPlayerSettings, savePlayerSettings]);
  useStableVolume(videoRef, stableVolume);

  const [sleepTimer, setSleepTimerState] = useState<SleepTimerOption>('Off');
  const [sleepTimerEndsAt, setSleepTimerEndsAt] = useState<number | null>(null);
  const setSleepTimer = useCallback((opt: SleepTimerOption) => {
    setSleepTimerState(opt);
    const ms = sleepTimerMs(opt);
    setSleepTimerEndsAt(ms == null ? null : Date.now() + ms);
  }, []);
  useEffect(() => {
    if (sleepTimerEndsAt == null) return;
    const tick = () => {
      if (Date.now() < sleepTimerEndsAt) return;
      const v = videoRef.current;
      if (v && !v.paused) {
        try { v.pause(); } catch { /* ignore */ }
      }
      setSleepTimerState('Off');
      setSleepTimerEndsAt(null);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [sleepTimerEndsAt, videoRef]);

  const [audioVisualizer, setAudioVisualizerState] = useState(false);
  const audioVisualizerStyleRef = useRef<AudioVisualizerStyle>(DEFAULT_AUDIO_VISUALIZER_STYLE);
  const setAudioVisualizer = useCallback(
    (v: boolean) => {
      if (!authPlaybackFeatures || isReel) return;
      setAudioVisualizerState(v);
      setPlayerSettings(prev => (prev ? { ...prev, audioVisualizer: v } : prev));
      savePlayerSettings({
        audioVisualizer: v,
        audioVisualizerStyle: audioVisualizerStyleRef.current,
      }).catch(() => {});
    },
    [authPlaybackFeatures, isReel, setPlayerSettings, savePlayerSettings]
  );

  const [audioVisualizerStyle, setAudioVisualizerStyleState] = useState<AudioVisualizerStyle>(
    DEFAULT_AUDIO_VISUALIZER_STYLE
  );
  const [statsForNerds, setStatsForNerds] = useState(false);
  // VR prefs survive provider remounts (watch → watch navigation) via the
  // module-level session store, but never persist across reloads.
  const [vrTheater, setVrTheaterState] = useState(() => vrSessionPrefs.theater);
  const [vrSeat, setVrSeatState] = useState(() => vrSessionPrefs.seat);
  const [vrSoundSystem, setVrSoundSystemState] = useState(() => vrSessionPrefs.sound);
  const [vrImmersive, setVrImmersiveState] = useState(() => vrSessionPrefs.immersive);
  const setVrImmersive = useCallback((v: boolean) => {
    vrSessionPrefs.immersive = v;
    setVrImmersiveState(v);
  }, []);
  const setVrTheater = useCallback((v: boolean) => {
    vrSessionPrefs.theater = v;
    setVrTheaterState(v);
  }, []);
  const setVrSeat = useCallback((v: string) => {
    vrSessionPrefs.seat = v;
    setVrSeatState(v);
  }, []);
  const setVrSoundSystem = useCallback((v: boolean) => {
    vrSessionPrefs.sound = v;
    setVrSoundSystemState(v);
  }, []);
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

  const [visualizerConfetti, setVisualizerConfettiState] = useState(true);

  const setVisualizerConfetti = useCallback(
    (v: boolean) => {
      if (!authPlaybackFeatures) return;
      setVisualizerConfettiState(v);
      setPlayerSettings(prev => (prev ? { ...prev, visualizerConfetti: v } : prev));
      savePlayerSettings({ visualizerConfetti: v }).catch(() => {});
    },
    [authPlaybackFeatures, setPlayerSettings, savePlayerSettings],
  );

  const [visualizerWave, setVisualizerWaveState] = useState(true);

  const setVisualizerWave = useCallback(
    (v: boolean) => {
      if (!authPlaybackFeatures) return;
      setVisualizerWaveState(v);
      setPlayerSettings(prev => (prev ? { ...prev, visualizerWave: v } : prev));
      savePlayerSettings({ visualizerWave: v }).catch(() => {});
    },
    [authPlaybackFeatures, setPlayerSettings, savePlayerSettings],
  );

  const [videoBounce, setVideoBounceState] = useState(false);

  const setVideoBounce = useCallback(
    (v: boolean) => {
      if (!authPlaybackFeatures) return;
      setVideoBounceState(v);
      setPlayerSettings(prev => (prev ? { ...prev, videoBounce: v } : prev));
      savePlayerSettings({ videoBounce: v }).catch(() => {});
    },
    [authPlaybackFeatures, setPlayerSettings, savePlayerSettings],
  );

  const [videoBounceIntensity, setVideoBounceIntensityState] = useState(1);

  const [ambientIntensity, setAmbientIntensityState] = useState(0.4);

  const setAmbientIntensity = useCallback(
    (v: number) => {
      if (!authPlaybackFeatures) return;
      const clamped = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0.4));
      setAmbientIntensityState(clamped);
      setPlayerSettings(prev => (prev ? { ...prev, ambientIntensity: clamped } : prev));
      savePlayerSettings({ ambientIntensity: clamped }).catch(() => {});
    },
    [authPlaybackFeatures, setPlayerSettings, savePlayerSettings],
  );

  const setVideoBounceIntensity = useCallback(
    (v: number) => {
      if (!authPlaybackFeatures) return;
      const clamped = Math.max(0.25, Math.min(2, Number.isFinite(v) ? v : 1));
      setVideoBounceIntensityState(clamped);
      setPlayerSettings(prev => (prev ? { ...prev, videoBounceIntensity: clamped } : prev));
      savePlayerSettings({ videoBounceIntensity: clamped }).catch(() => {});
    },
    [authPlaybackFeatures, setPlayerSettings, savePlayerSettings],
  );

  const [videoBounceInstruments, setVideoBounceInstrumentsState] = useState<StemConfettiInstruments>(
    DEFAULT_VIDEO_BOUNCE_INSTRUMENTS,
  );

  const setVideoBounceInstrument = useCallback(
    (type: StemType, enabled: boolean) => {
      if (!authPlaybackFeatures) return;
      setVideoBounceInstrumentsState((prev) => {
        const next = { ...prev, [type]: enabled };
        const serialized = serializeStemConfettiInstruments(next);
        setPlayerSettings((p) => (p ? { ...p, videoBounceInstruments: serialized } : p));
        savePlayerSettings({ videoBounceInstruments: serialized }).catch(() => {});
        return next;
      });
    },
    [authPlaybackFeatures, setPlayerSettings, savePlayerSettings],
  );

  const [stemConfettiInstruments, setStemConfettiInstrumentsState] = useState<StemConfettiInstruments>(
    DEFAULT_STEM_CONFETTI_INSTRUMENTS,
  );

  const setStemConfettiInstrument = useCallback(
    (type: StemType, enabled: boolean) => {
      if (!authPlaybackFeatures) return;
      setStemConfettiInstrumentsState((prev) => {
        const next = { ...prev, [type]: enabled };
        setPlayerSettings((p) =>
          p ? { ...p, stemConfettiInstruments: serializeStemConfettiInstruments(next) } : p,
        );
        savePlayerSettings({ stemConfettiInstruments: serializeStemConfettiInstruments(next) }).catch(
          () => {},
        );
        return next;
      });
    },
    [authPlaybackFeatures, setPlayerSettings, savePlayerSettings],
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
    if (!isReel) setLoopState(playerSettings.loop);
    setAutoPlayState(playerSettings.autoPlay);
    setStableVolumeState(playerSettings.stableVolume);
    setPlayerBackgroundState(playerSettings.playerBackground !== false);

    // Ambient mode (+ its sync/size sub-controls) is available on REELS too,
    // so the reel settings can actually drive the page ambience. Only the
    // auth gate applies  not the reel gate.
    if (authPlaybackFeatures) {
      setAmbientModeState(playerSettings.ambientMode);
      setAmbientSyncState(playerSettings.ambientSync === true);
      setAmbientSizeState(Math.max(1, Math.min(2, playerSettings.ambientSize ?? 2)));
    } else {
      setAmbientModeState(false);
    }

    // Heavy visualizer / dance-bounce stays watch-page only.
    if (authPlaybackFeatures && !isReel) {
      setAudioVisualizerState(playerSettings.audioVisualizer ?? false);
      const style = playerSettings.audioVisualizerStyle ?? DEFAULT_AUDIO_VISUALIZER_STYLE;
      audioVisualizerStyleRef.current = style;
      setAudioVisualizerStyleState(style);
      setVisualizerConfettiState(playerSettings.visualizerConfetti !== false);
      setStemConfettiInstrumentsState(
        parseStemConfettiInstruments(playerSettings.stemConfettiInstruments),
      );
      setVisualizerWaveState(playerSettings.visualizerWave !== false);
      setVideoBounceState(playerSettings.videoBounce === true);
      setVideoBounceIntensityState(
        Math.max(0.25, Math.min(2, playerSettings.videoBounceIntensity ?? 1)),
      );
      setAmbientIntensityState(
        Math.max(0, Math.min(1, playerSettings.ambientIntensity ?? 0.4)),
      );
      setVideoBounceInstrumentsState(
        parseStemInstrumentMap(playerSettings.videoBounceInstruments, DEFAULT_VIDEO_BOUNCE_INSTRUMENTS),
      );
    } else {
      setAudioVisualizerState(false);
      audioVisualizerStyleRef.current = DEFAULT_AUDIO_VISUALIZER_STYLE;
      setAudioVisualizerStyleState(DEFAULT_AUDIO_VISUALIZER_STYLE);
      setVisualizerConfettiState(true);
      setVisualizerWaveState(true);
      setVideoBounceState(false);
      setVideoBounceIntensityState(1);
      setVideoBounceInstrumentsState(DEFAULT_VIDEO_BOUNCE_INSTRUMENTS);
    }

    /** Spatial audio: parse stored config; fall back to defaults if cookie is empty/corrupt. */
    let parsed: SpatialAudioConfig = DEFAULT_SPATIAL_CONFIG;
    if (playerSettings.spatialAudioConfig) {
      try {
        const raw = JSON.parse(playerSettings.spatialAudioConfig) as Partial<SpatialAudioConfig> & {
          mode?: string;
        };
        // Migrate legacy mode names from the original implementation so saved
        // cookies don't get silently reset back to defaults after we renamed modes.
        const migrate = (m: string | undefined): SpatialAudioMode | null => {
          switch (m) {
            case 'stereo':
            case 'orbit':
            case 'tumble':
            case 'figure8':
            case 'manual':
            case 'room-front':
              return m;
            case 'orbit-horizontal':
              return 'orbit';
            case 'orbit-vertical':
              return 'tumble';
            default:
              return null;
          }
        };
        const migratedMode = migrate(raw.mode);
        parsed = {
          enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_SPATIAL_CONFIG.enabled,
          mode: migratedMode ?? DEFAULT_SPATIAL_CONFIG.mode,
          position: {
            x: Number.isFinite(raw.position?.x) ? Number(raw.position!.x) : 0,
            y: Number.isFinite(raw.position?.y) ? Number(raw.position!.y) : 0,
            z: Number.isFinite(raw.position?.z) ? Number(raw.position!.z) : -1,
          },
          radius: Number.isFinite(raw.radius)
            ? Math.max(0.1, Math.min(5, Number(raw.radius)))
            : DEFAULT_SPATIAL_CONFIG.radius,
          speedHz: Number.isFinite(raw.speedHz)
            ? Math.max(0.02, Math.min(2, Number(raw.speedHz)))
            : DEFAULT_SPATIAL_CONFIG.speedHz,
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
      // Don't touch the video element while AirPlay / Chromecast is active 
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
  }, [playerSettings, videoRef, authPlaybackFeatures, unlockPipReelAudio, isReel]);

  useEffect(() => {
    if (authPlaybackFeatures) return;
    setAmbientModeState(false);
    setAudioVisualizerState(false);
  }, [authPlaybackFeatures]);

  // ── Live cross-player sync ──────────────────────────────────────────
  // The initial load applies once per player. This re-applies the SHARED
  // settings whenever `playerSettings` changes  i.e. when ANY other mounted
  // player (mini player, neighbouring reel, watch page) toggles something, so
  // every player updates in lockstep. Uses the raw state setters (no cookie /
  // context write-back) so it can't loop.
  useEffect(() => {
    if (!playerSettings || !appliedInitialRef.current) return;
    if (!isReel) setLoopState(playerSettings.loop);
    setAutoPlayState(playerSettings.autoPlay);
    setStableVolumeState(playerSettings.stableVolume);
    setPlayerBackgroundState(playerSettings.playerBackground !== false);
    if (authPlaybackFeatures) {
      setAmbientModeState(playerSettings.ambientMode);
      setAmbientSyncState(playerSettings.ambientSync === true);
      setAmbientSizeState(Math.max(1, Math.min(2, playerSettings.ambientSize ?? 2)));
    }
    if (authPlaybackFeatures && !isReel) {
      setAudioVisualizerState(playerSettings.audioVisualizer ?? false);
      const style = playerSettings.audioVisualizerStyle ?? DEFAULT_AUDIO_VISUALIZER_STYLE;
      audioVisualizerStyleRef.current = style;
      setAudioVisualizerStyleState(style);
      setVisualizerConfettiState(playerSettings.visualizerConfetti !== false);
      setStemConfettiInstrumentsState(
        parseStemConfettiInstruments(playerSettings.stemConfettiInstruments),
      );
      setVisualizerWaveState(playerSettings.visualizerWave !== false);
      setVideoBounceState(playerSettings.videoBounce === true);
      setVideoBounceIntensityState(
        Math.max(0.25, Math.min(2, playerSettings.videoBounceIntensity ?? 1)),
      );
      setVideoBounceInstrumentsState(
        parseStemInstrumentMap(playerSettings.videoBounceInstruments, DEFAULT_VIDEO_BOUNCE_INSTRUMENTS),
      );
    }
    setState((s) =>
      s.playbackRate === playerSettings.playbackRate
        ? s
        : { ...s, playbackRate: playerSettings.playbackRate },
    );
  }, [playerSettings, authPlaybackFeatures, isReel]);

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

  // Build BOTH URL variants up-front. The SeekBar resolves which to use
  // at fetch time  preferring the new JSON, falling back to the legacy
  // PNG when the JSON 404s. Computing both here keeps the URL build
  // logic in one place.
  const waveformPrefix = useMemo(() => {
    if (!file || isReel) return null;
    return getWaveformImagePathPrefix({
      default_thumbnail: file.default_thumbnail,
      thumbnails: file.thumbnails,
      endpoint: file.endpoint,
      file_type: file.file_type,
    });
  }, [file?.id, file?.default_thumbnail, file?.thumbnails, file?.endpoint, file?.file_type, isReel]);

  const waveformUrl = useMemo(
    () => (waveformPrefix ? `/api/load/image/${waveformPrefix}waveform.json` : null),
    [waveformPrefix],
  );
  const waveformPngUrl = useMemo(
    () => (waveformPrefix ? `/api/load/image/${waveformPrefix}waveform.png` : null),
    [waveformPrefix],
  );
  const audioStemsUrl = useMemo(
    () => (waveformPrefix ? `/api/load/image/${waveformPrefix}audio_stems.json` : null),
    [waveformPrefix],
  );

  const [audioStems, setAudioStems] = useState<AudioStems | null>(null);
  useEffect(() => {
    setAudioStems(null);
    if (!audioStemsUrl) return;
    let alive = true;
    fetchAudioStems(audioStemsUrl).then((stems) => {
      if (!alive) return;
      setAudioStems(stems);
    });
    return () => {
      alive = false;
    };
  }, [audioStemsUrl]);
  const audioStemsAvailable = audioStems != null;

  // `data-user-paused` marks DELIBERATE pauses (tap / control bar / keyboard).
  // Reel auto-resume reads it to fix iOS system pauses (decoder reclaim during
  // scroll) without ever fighting a pause the user actually asked for.
  const play = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    delete v.dataset.userPaused;
    v.play().catch(() => {});
  }, []);

  const pause = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.dataset.userPaused = '1';
    v.pause();
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) {
      delete v.dataset.userPaused;
      v.play().catch(() => {});
    } else {
      v.dataset.userPaused = '1';
      v.pause();
    }
  }, []);

  const seek = useCallback((time: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(time, v.duration || 0));
  }, []);

  // Listen for `memories:seek-to` events fired by clickable timestamps in
  // comments / descriptions. If the event includes a fileId, ignore it
  // when it doesn't match this player's file  important for embed /
  // mini-player scenarios where multiple players exist simultaneously.
  // Also auto-plays after seeking, mirroring YouTube's behavior when you
  // click a timestamp in a comment.
  useEffect(() => {
    const onSeekTo = (e: Event) => {
      const ce = e as CustomEvent<{ seconds: number; fileId?: string }>;
      const detail = ce.detail;
      if (!detail || typeof detail.seconds !== "number") return;
      if (detail.fileId && file?.id && detail.fileId !== file.id) return;
      const v = videoRef.current;
      if (!v) return;
      const target = Math.max(0, Math.min(detail.seconds, v.duration || detail.seconds));
      v.currentTime = target;
      // Auto-play after click  matches YouTube. Wrapped in catch because
      // browsers may reject play() on a still-muted-autoplay-blocked tab.
      if (v.paused) v.play().catch(() => {});
    };
    window.addEventListener("memories:seek-to", onSeekTo);
    return () => window.removeEventListener("memories:seek-to", onSeekTo);
  }, [file?.id]);

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

  // Mirror fullscreen state into a ref so the stable toggle can read it.
  const isFullscreenRef = useRef(false);
  isFullscreenRef.current = state.isFullscreen;

  const toggleFullscreen = useCallback(async () => {
    try {
      // Desktop app: drive the native OS window fullscreen (the HTML5
      // Fullscreen API misbehaves in the frameless Electron window). The
      // container fills the window via CSS while the window is fullscreen.
      const bridge = windappFullscreenBridge();
      if (bridge) {
        await bridge.setFullScreen(!isFullscreenRef.current);
        return;
      }
      await enterPlayerFullscreen(videoRef.current, containerRef.current);
    } catch {
      /* ignore */
    }
  }, []);

  // Android fullscreen shows Chrome's NATIVE video controls — but our global
  // CSS hides every ::-webkit-media-controls. Hand the native UI back while
  // the VIDEO element itself is fullscreen on Android only; desktop and iOS
  // fullscreen the container (or iOS webkit video FS without native-controls class).
  useEffect(() => {
    const onFullscreenChange = () => {
      syncNativeVideoControls(videoRef.current);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
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
    // Idempotent: `useControlsVisibility` calls this on every `mousemove`
    // over the player. Returning the same state ref when nothing changed
    // lets React bail out instead of re-rendering all ~25 context consumers
    // 60120/sec while the pointer moves  the main cause of the player
    // dragging down navigation.
    setState(s => (s.controlsVisible === visible ? s : { ...s, controlsVisible: visible }));
  }, []);

  const setReelAuxiliaryChromeVisible = useCallback((visible: boolean) => {
    // Reels: route through the shared store so every reel player reflects the
    // same state. The subscription below applies it to local state.
    if (reelEmbedAutoHide) {
      reelChromeStore.set(visible);
      return;
    }
    setState(s =>
      s.reelAuxiliaryChromeVisible === visible ? s : { ...s, reelAuxiliaryChromeVisible: visible },
    );
  }, [reelEmbedAutoHide]);

  useEffect(() => {
    if (!reelEmbedAutoHide) return;
    setState(s => ({ ...s, reelAuxiliaryChromeVisible: reelChromeStore.get() }));
    return reelChromeStore.subscribe((v) =>
      setState(s => (s.reelAuxiliaryChromeVisible === v ? s : { ...s, reelAuxiliaryChromeVisible: v })),
    );
  }, [reelEmbedAutoHide]);

  const startInteraction = useCallback(() => {
    interactingRef.current = true;
    setState(s => {
      const nextAux = reelEmbedAutoHide ? true : s.reelAuxiliaryChromeVisible;
      if (s.controlsVisible && s.reelAuxiliaryChromeVisible === nextAux) return s;
      return { ...s, controlsVisible: true, reelAuxiliaryChromeVisible: nextAux };
    });
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
      if (!isReel && el.loop !== loop) {
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

  const setPlayerBackground = useCallback(
    (v: boolean) => {
      setPlayerBackgroundState(v);
      setPlayerSettings(prev => (prev ? { ...prev, playerBackground: v } : prev));
      savePlayerSettings({ playerBackground: v }).catch(() => {});
    },
    [setPlayerSettings, savePlayerSettings]
  );

  const setAmbientSync = useCallback(
    (v: boolean) => {
      setAmbientSyncState(v);
      setPlayerSettings(prev => (prev ? { ...prev, ambientSync: v } : prev));
      savePlayerSettings({ ambientSync: v }).catch(() => {});
    },
    [setPlayerSettings, savePlayerSettings]
  );

  const setAmbientSize = useCallback(
    (v: number) => {
      const clamped = Math.max(1, Math.min(2, v));
      setAmbientSizeState(clamped);
      setPlayerSettings(prev => (prev ? { ...prev, ambientSize: clamped } : prev));
      savePlayerSettings({ ambientSize: clamped }).catch(() => {});
    },
    [setPlayerSettings, savePlayerSettings]
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
    reelChromeBottomReservePx,
    setReelChromeBottomReservePx,
    startInteraction,
    endInteraction,
    spriteMeta,
    spriteUrl,
    setSpriteMeta,
    setSpriteUrl,
    waveformUrl,
    waveformPngUrl,
    audioStemsUrl,
    audioStems,
    audioStemsAvailable,
    stemConfettiInstruments,
    setStemConfettiInstrument,
    ambientMode: ambientModeState,
    setAmbientMode,
    ambientSync: ambientSyncState,
    setAmbientSync,
    ambientSize: ambientSizeState,
    setAmbientSize,
    playerBackground: playerBackgroundState,
    setPlayerBackground,
    stableVolume,
    setStableVolume,
    audioVisualizer,
    setAudioVisualizer,
    audioVisualizerStyle,
    setAudioVisualizerStyle,
    visualizerConfetti,
    setVisualizerConfetti,
    visualizerWave,
    setVisualizerWave,
    videoBounce,
    setVideoBounce,
    videoBounceIntensity,
    setVideoBounceIntensity,
    ambientIntensity,
    setAmbientIntensity,
    videoBounceInstruments,
    setVideoBounceInstrument,
    statsForNerds,
    setStatsForNerds,
    vrTheater,
    setVrTheater,
    vrSeat,
    setVrSeat,
    vrSoundSystem,
    setVrSoundSystem,
    vrImmersive,
    setVrImmersive,
    sleepTimer,
    setSleepTimer,
    sleepTimerEndsAt,
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
