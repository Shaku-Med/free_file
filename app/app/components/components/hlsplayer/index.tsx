import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router';
import { useInView } from 'react-intersection-observer';
import type { FileType, SeriesEpisodeGroup } from '~/lib/types';
import { PlayerProvider, usePlayerContext, type ThumbnailSpriteMeta } from './PlayerContext';
import { CaptionProvider } from './CaptionContext';
import CaptionOverlay from './overlays/CaptionOverlay';
import TiltOverlay from './overlays/VRTiltOverlay';
import VideoKickBounce from './overlays/VideoKickBounce';
import StemGlowLight from './overlays/StemGlowLight';
import EndCardOverlay from './overlays/EndCardOverlay';
import TiltRoomWalls, {
  TILT_ROOM_PERSPECTIVE_PX,
  tiltWorldStyle,
  tiltScreenStyle,
} from './overlays/TiltRoom3D';
import { FEED_EMBED_HIDE_CONTROLS, MINI_PLAYER_HIDE_CONTROLS, type HideControls } from './types';
import SeekBar from './controls/seek/SeekBar';
import PersistentBottomVisualizer from './controls/seek/PersistentBottomVisualizer';
import AudioVisualizerBars from './controls/seek/AudioVisualizerBars';
import { useHLS } from './hooks/useHLS';
import { useVideoEvents } from './hooks/useVideoEvents';
import { useMediaSession } from './hooks/useMediaSession';
import { usePlaybackPosition } from './hooks/usePlaybackPosition';
import { useWatchTimeHeartbeat } from './hooks/useWatchTimeHeartbeat';
import { useAutoplay } from './hooks/useAutoplay';
import { useControlsVisibility } from './hooks/useControlsVisibility';
import { useFullscreen } from './hooks/useFullscreen';
import { useWakeLock } from './hooks/useWakeLock';
import { useSpatialAudio, isSpatialAudioUiSupported } from './hooks/useSpatialAudio';
import ControlBar from './controls/ControlBar';
import { ReelInfoOverlay } from './overlays/ReelInfoOverlay';
// EndScreen was replaced by EndCardOverlay (centered 2-card end-of-video surface).
import BufferingSpinner from './overlays/BufferingSpinner';
import ErrorOverlay from './overlays/ErrorOverlay';
import AutoplayPrompt from './overlays/AutoplayPrompt';
import PipOverlay from './overlays/PipOverlay';
import PlayPauseFeedback from './overlays/PlayPauseFeedback';
import SeekFeedback from './overlays/SeekFeedback';
import PosterBackground from './overlays/PosterBackground';
import ShortcutOverlay from './overlays/ShortcutOverlay';
import StatsForNerdsOverlay from './overlays/StatsForNerdsOverlay';
import SkipMarkerOverlay from './overlays/SkipMarkerOverlay';
import SpatialAudioDialog from './controls/settings/SpatialAudioDialog';
import { SettingsMenuBody } from './controls/settings/SettingsMenu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import AmbientBackground from '~/components/components/hlsplayer/overlays/AmbientBackground';
import GuestPreviewWall from '~/components/components/hlsplayer/overlays/GuestPreviewWall';
import GuestPreviewNudge from '~/components/components/hlsplayer/overlays/GuestPreviewNudge';
import { GuestPlaybackSignInDialog } from './controls/GuestPlaybackSignInDialog';
import { useGuestWatchLimit } from './hooks/useGuestWatchLimit';
import { usePictureInPictureContext } from '~/lib/Context/PictureInPictureContext';
import { useFileContext } from '~/lib/Context/Context';
import { useGlobalPlayerLayout } from '~/lib/Context/GlobalPlayerLayoutContext';
import { isPipChromeRoute } from '~/routes/pip/pipEnv';
import { useMiniPlayerContext } from '~/lib/Context/MiniPlayerContext';
import { useWatchHlsSurface } from '~/lib/Context/WatchHlsSurfaceContext';
import { isMobile } from 'react-device-detect';
import { getVideoSrc } from '~/lib/utils';
import { getSeriesPreviousVideo } from '~/routes/Dynamic/fun/mapSeriesRpcRows';
import { getSquareMediaSessionArtwork } from '~/lib/utils/mediaSessionSquareArtwork';

interface CallBackProps {
  src: string;
  colors: string[];
}

export interface HLSPlayerProps {
  src: string;
  className?: string;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onError?: (error: any) => void;
  onHLSReady?: (hls: any) => void;
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  playsInline?: boolean;
  poster?: string;
  imageID?: string;
  file?: FileType | null;
  callBack?: (props: CallBackProps) => void;
  onVideoRef?: (ref: HTMLVideoElement | null) => void;
  isReel?: boolean;
  suggestedVideos?: FileType[];
  /** In-series order after the current video; autoplay prefers these over related. */
  seriesUpNextVideos?: FileType[];
  /**
   * Full series episode tree when on the watch page. Enables “previous” in Media Session / series order.
   */
  seriesEpisodeGroups?: SeriesEpisodeGroup[] | null;
  endScreenUserActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
  currentUserId?: string;
  onVideoSelect?: (video: FileType) => void;
  onNext?: () => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onAmbientModeChange?: (active: boolean) => void;
  startTime?: number;
  hideControls?: HideControls;
  /** When false, ambient, visualizer, autoplay next, and next-video control require sign-in (watch page). */
  authPlaybackFeatures?: boolean;
  /** Signed-out preview cap (seconds); null when signed in or unlimited. */
  guestWatchLimitSeconds?: number | null;
  /**
   * With `isReel`, show the bottom control bar (seek, play/pause, volume, etc.) for embedded feeds
   * (e.g. PiP vertical feed). Merged with `hideControls` and defaults from `FEED_EMBED_HIDE_CONTROLS`.
   */
  showFeedPlayerControls?: boolean;
  /** When set, shows a back control unless `hideControls.back` is true. */
  onBack?: () => void;
  /**
   * Document PiP vertical reel: keep sound on (no global saved mute, no forced mute on inactive slides).
   */
  unlockPipReelAudio?: boolean;
  /**
   * Swiper / deck active slide. iOS + CSS transforms can leave IntersectionObserver stuck false on the
   * `<video>` while the slide is still the active index  combine with `reelVideoInView` so the primary
   * reel keeps autoplay without un-gating neighbors (they pass false here).
   */
  reelSwiperActive?: boolean;
  /**
   * When true, skip window-level player shortcuts (space, arrows, f, m, etc.) so parent UI can own
   * keys  e.g. `/reel` page deck (Swiper uses j/k separately at the document level).
   */
  disableKeyboardShortcuts?: boolean;
  /** Reel page: creator/title/caption rendered inside the player, above controls. */
  reelInfoSlot?: React.ReactNode;
}

const HLSPlayer: React.FC<HLSPlayerProps> = (props) => (
  <PlayerProvider
    src={props.src}
    file={props.file ?? null}
    imageID={props.imageID ?? ''}
    isReel={props.isReel ?? false}
    loop={props.loop ?? false}
    initialMuted={props.unlockPipReelAudio ? false : (props.muted ?? false)}
    initialAutoPlay={props.autoPlay ?? false}
    videoRef={props.videoRef}
    startTime={props.startTime}
    authPlaybackFeatures={props.authPlaybackFeatures ?? true}
    reelEmbedAutoHide={Boolean((props.showFeedPlayerControls ?? false) && (props.isReel ?? false))}
    unlockPipReelAudio={props.unlockPipReelAudio ?? false}
  >
    <CaptionProvider file={props.file ?? null} videoRef={props.videoRef}>
      <PlayerInner {...props} />
    </CaptionProvider>
  </PlayerProvider>
);

/** Reels are discovery-only  never autoplay / “Up next” / end-screen queue targets. */
function withoutReels(list: FileType[] | undefined): FileType[] {
  if (!list?.length) return [];
  return list.filter((v) => !v.is_reel);
}

function PlayerInner({
  src,
  className = '',
  onPlay,
  onPause,
  onEnded,
  onError,
  autoPlay = false,
  muted = false,
  loop = false,
  playsInline = true,
  imageID = '',
  file = null,
  callBack,
  onVideoRef,
  isReel = false,
  suggestedVideos,
  seriesUpNextVideos,
  seriesEpisodeGroups = null,
  endScreenUserActions,
  currentUserId,
  onVideoSelect,
  onNext,
  videoRef,
  onAmbientModeChange,
  hideControls,
  guestWatchLimitSeconds = null,
  showFeedPlayerControls = false,
  onBack,
  reelSwiperActive = false,
  disableKeyboardShortcuts = false,
  reelInfoSlot,
}: HLSPlayerProps) {
  const seriesPlayQueue = useMemo(
    () => withoutReels(seriesUpNextVideos),
    [seriesUpNextVideos],
  );
  const relatedPlayQueue = useMemo(() => withoutReels(suggestedVideos), [suggestedVideos]);

  const navigate = useNavigate();
  const location = useLocation();
  const globalPlayerLayout = useGlobalPlayerLayout();
  const { surface: watchHlsSurface } = useWatchHlsSurface();
  const { theaterMode, setTheaterMode, setPlayerSettings, savePlayerSettings } = useFileContext();
  const {
    containerRef,
    state,
    setState,
    togglePlay,
    setPlaybackRate,
    setControlsVisible,
    setReelAuxiliaryChromeVisible,
    reelEmbedAutoHide,
    isReel: isReelCtx,
    setSpriteMeta,
    setSpriteUrl,
    ambientMode,
    audioVisualizer,
    audioStemsAvailable,
    statsForNerds,
    spatialAudio,
    setSpatialAudio,
    spatialAudioDialogOpen,
    setSpatialAudioDialogOpen,
    autoPlay: autoPlayEnabled,
    loop: loopEnabled,
    authPlaybackFeatures: authPlayback,
    unlockPipReelAudio,
    tiltMode,
    tiltRotation,
    tiltZoom,
  } = usePlayerContext();
  /**
   * Skip-intro / next-episode markers come from the owner-edited `metadata.markers` jsonb on
   * the file row  same data for every viewer, just like Netflix. The VideoCard edit dialog
   * writes this; the player only consumes it.
   */
  const skipMarkers = useMemo(() => {
    const meta = file?.metadata;
    if (!meta || typeof meta !== 'object') return null;
    const m = (meta as Record<string, unknown>).markers;
    if (!m || typeof m !== 'object') return null;
    const r = m as Record<string, unknown>;
    const num = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
    const introStart = num(r.introStart);
    const introEnd = num(r.introEnd);
    const creditsStart = num(r.creditsStart);
    if (introStart == null && introEnd == null && creditsStart == null) return null;
    return { introStart, introEnd, creditsStart };
  }, [file?.metadata]);
  const [skipMarkerActive, setSkipMarkerActive] = useState(false);

  /**
   * Reel / PiP vertical feed: observe the `<video>` like `ImageLoad`  virtual slides keep neighbors mounted.
   *
   * Strict threshold (0.6) is critical: during Swiper virtual transitions the outgoing, incoming and
   * pre-rendered neighbor slides can all partially intersect the viewport. With a permissive threshold
   * (0 + positive rootMargin) every one of them flips `inView=true`, `autoplayAllowed` becomes true on
   * all mounted slides, and every reel in the feed starts playing at once. Requiring 60% visibility
   * means exactly one slide wins at a time and all others pause + mute.
   */
  const { ref: setReelVideoInViewRef, inView: reelVideoInView } = useInView({
    threshold: 0.6,
    triggerOnce: false,
    skip: !isReelCtx,
    initialInView: !isReelCtx,
  });

  const assignVideoRef = useCallback(
    (node: HTMLVideoElement | null) => {
      (videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = node;
      setReelVideoInViewRef(node);
      onVideoRef?.(node);
    },
    [videoRef, setReelVideoInViewRef, onVideoRef],
  );

  const embedReelControls = Boolean(showFeedPlayerControls && isReelCtx);

  const effectiveHideControls = useMemo(() => {
    let merged: HideControls | undefined = hideControls;
    if (embedReelControls) {
      merged = { ...FEED_EMBED_HIDE_CONTROLS, ...hideControls };
    }
    if (
      globalPlayerLayout === 'mini' &&
      !(watchHlsSurface?.props && file && watchHlsSurface.props.file?.unique_id === file.unique_id)
    ) {
      merged = { ...MINI_PLAYER_HIDE_CONTROLS, ...merged };
    }
    return merged;
  }, [embedReelControls, hideControls, globalPlayerLayout, watchHlsSurface, file?.unique_id]);

  const guestLimitActive =
    !authPlayback &&
    guestWatchLimitSeconds != null &&
    guestWatchLimitSeconds > 0;
  const {
    wallOpen,
    dismissWall,
    nudgeVisible,
    secondsRemaining,
    dismissNudge,
  } = useGuestWatchLimit(
    videoRef,
    guestWatchLimitSeconds,
    guestLimitActive && !isReelCtx
  );

  // Height of the persistent visualizer strip (SeekBarSpectrum h-10 + pb-2).
  const visualizerStripPx = 48;

  const [isMobileView, setIsMobileView] = useState(isMobile);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobileView(isMobile || mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  const {
    isPipActive,
    isContentInPip,
    activePipKind,
    pipContentId,
    notifyBrowserDrivenNativePipEntered,
    notifyBrowserDrivenWebKitPipEntered,
  } = usePictureInPictureContext();
  const inPipForThisVideo = isPipActive && isContentInPip(imageID);
  const onPipChrome = isPipChromeRoute(location.pathname);
  /** Native / WebKit PiP uses this `<video>`  must not pause or block `play`. Document PiP uses a separate iframe. */
  const documentPipPausesMain = inPipForThisVideo && activePipKind === 'document';
  /** A different file is in PiP  pause this player so only one plays. */
  const otherVideoInPipBlocksThisPlayer =
    Boolean(isPipActive && pipContentId !== null && pipContentId !== imageID);
  const pipPauseMainPlayer = documentPipPausesMain || otherVideoInPipBlocksThisPlayer;
  const { miniPlayer, activateMiniPlayer: triggerMiniPlayer, containerRef: miniPlayerContainerRef, isPortalMode, containerReady, getNavigateBackTarget } = useMiniPlayerContext();

  const isMiniPlayerPortalActive = Boolean(
    miniPlayer && isPortalMode && file && miniPlayer.file?.unique_id === file.unique_id && containerReady && miniPlayerContainerRef.current
  );
  const showAudioVisualizer =
    audioVisualizer &&
    audioStemsAvailable &&
    authPlayback &&
    !isReelCtx &&
    !inPipForThisVideo &&
    !onPipChrome;
  const callBackRef = useRef(callBack);
  callBackRef.current = callBack;
  const [mediaSessionImage, setMediaSessionImage] = useState<string | null>(null);
  // Absolute HTTP poster URL. Goes into MediaMetadata.artwork as a
  // network-fetchable fallback so cast / AirPlay receivers can show the
  // poster even when the HLS stream isn't reachable on the TV side.
  // Cast can't fetch the blob: URL that mediaSessionImage carries; this
  // one IS fetchable because it points at the regular thumbnail endpoint.
  const [mediaSessionPosterHttp, setMediaSessionPosterHttp] = useState<string | null>(null);
  const mediaSessionFileUidRef = useRef<string | undefined>(file?.unique_id);
  mediaSessionFileUidRef.current = file?.unique_id;

  useEffect(() => {
    setMediaSessionImage(null);
    setMediaSessionPosterHttp(null);
  }, [file?.unique_id]);
  const [showPlayPauseFeedback, setShowPlayPauseFeedback] = useState(false);
  const [feedbackFading, setFeedbackFading] = useState(false);
  const [feedbackIconPlaying, setFeedbackIconPlaying] = useState(true);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showSeekFeedback, setShowSeekFeedback] = useState(false);
  const [seekFeedbackDirection, setSeekFeedbackDirection] = useState<'back' | 'forward'>('back');
  const [seekFeedbackFading, setSeekFeedbackFading] = useState(false);
  const seekFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<{ time: number; x: number } | null>(null);
  const lastDoubleTapTimeRef = useRef(0);
  /** Rapid seeks in the same direction grow the jump (+step per repeat, capped). */
  const KEYBOARD_SEEK_BASE = 5;
  const DOUBLE_TAP_SEEK_BASE = 10;
  const SEEK_BURST_STEP = 5;
  const SEEK_BURST_MAX = 60;
  const SEEK_BURST_WINDOW_MS = 850;
  const seekBurstRef = useRef<{
    direction: 'back' | 'forward' | null;
    count: number;
    lastTs: number;
    burstBase: number;
  }>({ direction: null, count: 0, lastTs: 0, burstBase: KEYBOARD_SEEK_BASE });

  const [seekFeedbackSeconds, setSeekFeedbackSeconds] = useState(DOUBLE_TAP_SEEK_BASE);

  useEffect(() => {
    seekBurstRef.current = {
      direction: null,
      count: 0,
      lastTs: 0,
      burstBase: KEYBOARD_SEEK_BASE,
    };
  }, [file?.unique_id]);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const triggerPlayPauseFeedback = useCallback(() => {
    if (isReelCtx) return;
    if (isMobile) return;
    setFeedbackIconPlaying(!state.isPlaying);
    setShowPlayPauseFeedback(true);
    setFeedbackFading(false);
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    feedbackTimeoutRef.current = setTimeout(() => {
      setFeedbackFading(true);
      feedbackTimeoutRef.current = setTimeout(() => {
        setShowPlayPauseFeedback(false);
        setFeedbackFading(false);
        feedbackTimeoutRef.current = null;
      }, 300);
    }, 600);
  }, [isReelCtx, state.isPlaying]);

  useEffect(() => () => {
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    if (seekFeedbackTimeoutRef.current) clearTimeout(seekFeedbackTimeoutRef.current);
  }, []);

  useHLS(videoRef);
  useVideoEvents(videoRef, { onPlay, onPause, onEnded, onError });
  usePlaybackPosition(videoRef);
  useWatchTimeHeartbeat(videoRef);
  useFullscreen();
  useWakeLock(videoRef);
  // Reels always autoplay the in-view / active slide  that's the whole point
  // of the reel feed  so they must NOT inherit the global autoplay toggle.
  // Otherwise, with autoplay off, useAutoplay actively pauses the active reel
  // and fights the reel's own play logic (the slide keeps getting paused).
  // Non-reel players keep respecting the user's autoplay preference.
  const autoplayAllowed = isReelCtx
    ? reelVideoInView || reelSwiperActive
    : autoPlayEnabled;
  const { showPrompt, enableAutoplay, dismissPrompt } = useAutoplay(
    autoplayAllowed,
    videoRef,
    { muteVideoWhenAutoplayDisabled: !unlockPipReelAudio },
  );
  useControlsVisibility();
  useSpatialAudio(videoRef, spatialAudio);

  /**
   * Reel audio gate: guarantees only the in-view reel slide is audible.
   * - Off-screen: force pause + mute. Without this, `unlockPipReelAudio` tells `useAutoplay` not to
   *   mute on pause, so neighbors would leak audio the instant anything kicks them into `play()`.
   * - Back in view (only when the context asked for sound via `unlockPipReelAudio`, e.g. PiP reel):
   *   unmute. `useAutoplay`'s `attemptAutoplayWithSound` doesn't always flip `muted=false` (the
   *   non-autoplay-service branch just calls `video.play()`), so without this the slide re-enters
   *   stuck on the mute we set when it went off-screen.
   *   Feeds that opted into silent preview (`muted=true`, no unlock flag) are left alone.
   */
  useEffect(() => {
    if (!isReelCtx) return;
    const v = videoRef.current;
    if (!v) return;
    if (!reelVideoInView && !reelSwiperActive) {
      if (!v.paused) v.pause();
      if (!v.muted) v.muted = true;
    } else if (unlockPipReelAudio) {
      if (v.muted) v.muted = false;
    }
  }, [isReelCtx, reelVideoInView, reelSwiperActive, unlockPipReelAudio, videoRef]);

  useEffect(() => {
    if (!pipPauseMainPlayer) return;
    setControlsVisible(false);
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    const keepPaused = () => {
      v.pause();
    };
    v.addEventListener('play', keepPaused);
    return () => v.removeEventListener('play', keepPaused);
  }, [pipPauseMainPlayer, setControlsVisible, videoRef]);

  /** Sync context when the browser opens default/native PiP or WebKit presentation PiP (not via our PiP button). */
  useEffect(() => {
    if (isReelCtx) return;
    let cancelled = false;
    let attachedEl: HTMLVideoElement | null = null;
    let attempts = 0;
    const maxAttempts = 120;

    const tryInitialSync = (v: HTMLVideoElement) => {
      const wv = v as HTMLVideoElement & { webkitPresentationMode?: string };
      if (wv.webkitPresentationMode === 'picture-in-picture') {
        notifyBrowserDrivenWebKitPipEntered(v, imageID);
        return;
      }
      if (document.pictureInPictureElement === v) {
        notifyBrowserDrivenNativePipEntered(v, imageID);
      }
    };

    const onEnterNative = () => {
      const v = videoRef.current;
      if (!v) return;
      notifyBrowserDrivenNativePipEntered(v, imageID);
    };

    const onWebKitPresentation = () => {
      const v = videoRef.current;
      if (!v) return;
      const wv = v as HTMLVideoElement & { webkitPresentationMode?: string };
      if (wv.webkitPresentationMode === 'picture-in-picture') {
        notifyBrowserDrivenWebKitPipEntered(v, imageID);
      }
    };

    const attach = (v: HTMLVideoElement) => {
      attachedEl = v;
      tryInitialSync(v);
      v.addEventListener('enterpictureinpicture', onEnterNative);
      v.addEventListener('webkitpresentationmodechanged', onWebKitPresentation);
    };

    const tick = () => {
      if (cancelled) return;
      const v = videoRef.current;
      if (v) {
        attach(v);
        return;
      }
      attempts += 1;
      if (attempts < maxAttempts) {
        requestAnimationFrame(tick);
      }
    };

    tick();

    return () => {
      cancelled = true;
      if (attachedEl) {
        attachedEl.removeEventListener('enterpictureinpicture', onEnterNative);
        attachedEl.removeEventListener('webkitpresentationmodechanged', onWebKitPresentation);
      }
    };
  }, [
    isReelCtx,
    imageID,
    notifyBrowserDrivenNativePipEntered,
    notifyBrowserDrivenWebKitPipEntered,
    videoRef,
  ]);

  const handleTheaterModeChange = useCallback(
    (active: boolean) => {
      setTheaterMode(active);
      setPlayerSettings(prev => (prev ? { ...prev, theaterMode: active } : prev));
      savePlayerSettings({ theaterMode: active }).catch(() => {});
    },
    [setTheaterMode, setPlayerSettings, savePlayerSettings]
  );

  const handlePosterImageLoaded = useCallback((imgSrc: string, colors: string[], mediaSessionUrl?: string) => {
    callBackRef.current?.({ src: imgSrc, colors });
    const source = mediaSessionUrl ?? imgSrc;
    const uid = file?.unique_id;
    // Capture the absolute HTTP poster up-front. PosterBackground already
    // prepends window.location.origin so `mediaSessionUrl` is a fully
    // qualified URL  perfect for cast / AirPlay receivers to fetch.
    if (mediaSessionUrl) {
      setMediaSessionPosterHttp(mediaSessionUrl);
    }
    if (!source) {
      setMediaSessionImage(null);
      return;
    }
    if (!uid) {
      setMediaSessionImage(source);
      return;
    }
    const requestUid = uid;
    const cacheKey = `ms-sq:${requestUid}:${source}`;
    void getSquareMediaSessionArtwork(source, cacheKey, { size: 512 }).then((url) => {
      if (!url) return;
      if (mediaSessionFileUidRef.current !== requestUid) return;
      setMediaSessionImage(url);
    });
  }, [file?.unique_id]);

  useEffect(() => {
    if (onAmbientModeChange) {
      onAmbientModeChange(ambientMode);
    }
  }, [ambientMode, onAmbientModeChange]);

  useEffect(() => {
    if (onVideoRef && videoRef.current) onVideoRef(videoRef.current);
    return () => { if (onVideoRef) onVideoRef(null); };
  }, [onVideoRef]);

  // Sprite-sheet URL derived from the file's thumbnail prefix. Used both to
  // fetch the meta JSON and to render the hidden preload <img> below.
  const spriteSheetUrl = useMemo(() => {
    const prefix =
      file?.default_thumbnail && typeof file.default_thumbnail === 'string'
        ? file.default_thumbnail.replace(/[^/]+$/, '')
        : '';
    return prefix ? `/api/load/image/${prefix}thumbnail_preview.jpg` : null;
  }, [file?.default_thumbnail]);

  useEffect(() => {
    const prefix =
      file?.default_thumbnail && typeof file.default_thumbnail === 'string'
        ? file.default_thumbnail.replace(/[^/]+$/, '')
        : '';
    if (!prefix || !spriteSheetUrl) return;

    let cancelled = false;
    const metaUrl = `/api/load/image/${prefix}thumbnail_preview.json`;

    const loadSpriteMeta = async () => {
      try {
        const res = await fetch(metaUrl);
        if (!res.ok || cancelled) return;
        const meta = (await res.json()) as ThumbnailSpriteMeta;
        if (cancelled) return;
        if (meta?.cells?.length) {
          setSpriteMeta(meta);
          setSpriteUrl(spriteSheetUrl);
        }
      } catch {}
    };
    loadSpriteMeta();

    return () => {
      cancelled = true;
    };
  }, [file?.default_thumbnail, spriteSheetUrl, setSpriteMeta, setSpriteUrl]);

  const triggerSeekFeedbackOverlay = useCallback(
    (direction: 'back' | 'forward', seconds: number) => {
      if ((isReelCtx && !embedReelControls) || inPipForThisVideo) return;
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
        feedbackTimeoutRef.current = null;
      }
      setShowPlayPauseFeedback(false);
      setSeekFeedbackDirection(direction);
      setSeekFeedbackSeconds(seconds);
      setSeekFeedbackFading(false);
      setShowSeekFeedback(true);
      if (seekFeedbackTimeoutRef.current) clearTimeout(seekFeedbackTimeoutRef.current);
      seekFeedbackTimeoutRef.current = setTimeout(() => {
        setSeekFeedbackFading(true);
        seekFeedbackTimeoutRef.current = setTimeout(() => {
          setShowSeekFeedback(false);
          seekFeedbackTimeoutRef.current = null;
        }, 300);
      }, 600);
    },
    [isReelCtx, embedReelControls, inPipForThisVideo],
  );

  const consumeSeekBurstDelta = useCallback((direction: 'back' | 'forward', kind: 'keyboard' | 'doubleTap') => {
    const now = performance.now();
    const b = seekBurstRef.current;
    const thisBase = kind === 'doubleTap' ? DOUBLE_TAP_SEEK_BASE : KEYBOARD_SEEK_BASE;
    if (b.direction !== direction || now - b.lastTs > SEEK_BURST_WINDOW_MS) {
      b.direction = direction;
      b.count = 1;
      b.burstBase = thisBase;
    } else {
      b.count += 1;
    }
    b.lastTs = now;
    return Math.min(SEEK_BURST_MAX, b.burstBase + (b.count - 1) * SEEK_BURST_STEP);
  }, []);

  const performSeekByTap = useCallback(
    (clientX: number) => {
      const container = containerRef.current;
      const video = videoRef.current;
      if (!container || !video || (isReelCtx && !embedReelControls) || inPipForThisVideo) return;
      const rect = container.getBoundingClientRect();
      const x = clientX - rect.left;
      const width = rect.width;
      if (x < width / 3) {
        const delta = consumeSeekBurstDelta('back', 'doubleTap');
        video.currentTime = Math.max(0, video.currentTime - delta);
        triggerSeekFeedbackOverlay('back', delta);
      } else if (x > (width * 2) / 3) {
        const delta = consumeSeekBurstDelta('forward', 'doubleTap');
        video.currentTime = Math.min(video.duration || 0, video.currentTime + delta);
        triggerSeekFeedbackOverlay('forward', delta);
      }
    },
    [isReelCtx, embedReelControls, inPipForThisVideo, triggerSeekFeedbackOverlay, consumeSeekBurstDelta],
  );

  const handleVideoClick = useCallback(() => {
    if (isReelCtx && !embedReelControls) return;
    if (inPipForThisVideo) return;
    if (isMobile && !embedReelControls) return;
    if (Date.now() - lastDoubleTapTimeRef.current < 300) return;
    // Reel chrome hidden: first tap just reveals controls (don't also pause).
    if (reelEmbedAutoHide && !state.reelAuxiliaryChromeVisible) {
      setReelAuxiliaryChromeVisible(true);
      return;
    }
    togglePlay();
    triggerPlayPauseFeedback();
  }, [
    isReelCtx,
    embedReelControls,
    inPipForThisVideo,
    reelEmbedAutoHide,
    state.reelAuxiliaryChromeVisible,
    setReelAuxiliaryChromeVisible,
    togglePlay,
    triggerPlayPauseFeedback,
  ]);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isReelCtx && !embedReelControls) return;
      if (inPipForThisVideo) return;
      e.preventDefault();
      lastDoubleTapTimeRef.current = Date.now();
      performSeekByTap(e.clientX);
    },
    [isReelCtx, embedReelControls, inPipForThisVideo, performSeekByTap]
  );

  /** Prefer series order, then related  matches end-screen autoplay when `onNext` is not supplied. */
  const handleNextVideo = useCallback(() => {
    if (onNext) {
      onNext();
      return;
    }
    const next = seriesPlayQueue[0] ?? relatedPlayQueue[0];
    if (next && onVideoSelect) onVideoSelect(next);
  }, [onNext, seriesPlayQueue, relatedPlayQueue, onVideoSelect]);

  const hasNextControl =
    typeof onNext === "function" ||
    (!!onVideoSelect && !!(seriesPlayQueue[0] || relatedPlayQueue[0]));

  const nextVideoForTooltip = useMemo(() => {
    return seriesPlayQueue[0] ?? relatedPlayQueue[0];
  }, [seriesPlayQueue, relatedPlayQueue]);

  const nextVideoTooltipBadge = useMemo(() => {
    const next = nextVideoForTooltip;
    if (!next) return undefined;
    const fromSeries = seriesPlayQueue[0];
    if (fromSeries && fromSeries.unique_id === next.unique_id) return "Next in series";
    return "Up next";
  }, [nextVideoForTooltip, seriesPlayQueue]);

  const handlePreviousVideo = useCallback(() => {
    if (!onVideoSelect || !file?.unique_id || !seriesEpisodeGroups?.length) return;
    const prev = getSeriesPreviousVideo(seriesEpisodeGroups, file.unique_id);
    if (prev) onVideoSelect(prev);
  }, [onVideoSelect, file?.unique_id, seriesEpisodeGroups]);

  const hasMediaSessionPrevious = useMemo(() => {
    if (!onVideoSelect || !file?.unique_id || !seriesEpisodeGroups?.length) return false;
    return Boolean(getSeriesPreviousVideo(seriesEpisodeGroups, file.unique_id));
  }, [onVideoSelect, file?.unique_id, seriesEpisodeGroups]);

  useMediaSession(
    mediaSessionImage,
    videoRef,
    !isReelCtx
      ? {
          canNext: hasNextControl,
          canPrevious: hasMediaSessionPrevious,
          onNext: handleNextVideo,
          onPrevious: handlePreviousVideo,
        }
      : null,
    mediaSessionPosterHttp,
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      // Tap-to-toggle-controls is intentionally NOT done here. The
      // existing `useControlsVisibility` hook already wires touchstart
      // on the container to show controls + auto-hide after 3s, which
      // is the standard mobile video-player behavior. Adding another
      // toggle on touchend caused a visible flash (show via touchstart,
      // immediately hide via this handler)  so this handler now ONLY
      // owns the double-tap-to-seek gesture.
      if (isReelCtx && !embedReelControls) return;
      if (inPipForThisVideo) return;
      const touch = e.changedTouches[0];
      if (!touch) return;

      // Restrict to taps that landed on the bare video  chrome taps
      // are handled by their own buttons / overlays.
      const target = e.target as HTMLElement | null;
      if (!target || target !== videoRef.current) return;

      const now = Date.now();
      const x = touch.clientX;
      const prev = lastTapRef.current;
      const isDoubleTap = prev && now - prev.time < 350 && Math.abs(x - prev.x) < 80;
      lastTapRef.current = { time: now, x };
      if (isDoubleTap) {
        lastDoubleTapTimeRef.current = now;
        performSeekByTap(x);
      }
    },
    [
      isReelCtx,
      embedReelControls,
      inPipForThisVideo,
      videoRef,
      performSeekByTap,
    ],
  );

  useEffect(() => {
    if (disableKeyboardShortcuts) return;
    if (isReelCtx && !embedReelControls) return;
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const video = videoRef.current;
      if (!video) return;
      if (inPipForThisVideo) return;

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          triggerPlayPauseFeedback();
          break;
        case 'ArrowLeft':
        case 'j': {
          e.preventDefault();
          const delta = consumeSeekBurstDelta('back', 'keyboard');
          video.currentTime = Math.max(0, video.currentTime - delta);
          triggerSeekFeedbackOverlay('back', delta);
          break;
        }
        case 'ArrowRight':
        case 'l': {
          e.preventDefault();
          const delta = consumeSeekBurstDelta('forward', 'keyboard');
          video.currentTime = Math.min(video.duration, video.currentTime + delta);
          triggerSeekFeedbackOverlay('forward', delta);
          break;
        }
        case 'ArrowUp':
          e.preventDefault();
          video.volume = Math.min(1, video.volume + 0.05);
          break;
        case 'ArrowDown':
          e.preventDefault();
          video.volume = Math.max(0, video.volume - 0.05);
          break;
        case 'm':
          e.preventDefault();
          video.muted = !video.muted;
          break;
        case 'f': {
          e.preventDefault();
          if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
          } else {
            const isMobile =
              typeof window !== 'undefined' &&
              (window.innerWidth < 768 || 'ontouchstart' in window);
            const el = isMobile ? videoRef.current : containerRef.current;
            el?.requestFullscreen().catch(() => {});
          }
          break;
        }
        case 't':
          if (isMobileView || !authPlayback) break;
          e.preventDefault();
          handleTheaterModeChange(!theaterMode);
          break;
        case ',':
          if (!e.shiftKey) break; // < is Shift+,
          e.preventDefault();
          setPlaybackRate(Math.max(0.25, (video.playbackRate || 1) - 0.25));
          break;
        case '.':
          if (!e.shiftKey) break; // > is Shift+.
          e.preventDefault();
          setPlaybackRate(Math.min(2, (video.playbackRate || 1) + 0.25));
          break;
        case 'i':
          if (!authPlayback) break;
          e.preventDefault();
          if (file && video) {
            const backTarget = getNavigateBackTarget();
            triggerMiniPlayer(
              {
                // `src` is the JIT-minted LoadPlay URL from the parent's
                // usePlaybackUrl hook. The getVideoSrc fallback is only
                // hit when no src was passed  defensive, legacy proxy.
                src: src || getVideoSrc(file.endpoint ?? '', file.file_type),
                file,
                imageID: imageID || file.unique_id,
              },
              { navigateTo: backTarget }
            );
            navigate(backTarget);
          }
          break;
        case '?':
          e.preventDefault();
          setShowShortcuts(prev => !prev);
          break;
        case 'Escape':
          if (showShortcuts) {
            e.preventDefault();
            setShowShortcuts(false);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [
    disableKeyboardShortcuts,
    isReelCtx,
    embedReelControls,
    inPipForThisVideo,
    togglePlay,
    triggerPlayPauseFeedback,
    triggerSeekFeedbackOverlay,
    consumeSeekBurstDelta,
    theaterMode,
    handleTheaterModeChange,
    isMobileView,
    setPlaybackRate,
    showShortcuts,
    file,
    src,
    imageID,
    triggerMiniPlayer,
    getNavigateBackTarget,
    authPlayback,
    navigate,
  ]);

  /** Feed embed reel: outer chrome stays visible; ControlBar shows seek-only vs full via `reelAuxiliaryChromeVisible`. */
  const showControls =
    embedReelControls ||
    (state.controlsVisible &&
      !isReelCtx &&
      !inPipForThisVideo &&
      !otherVideoInPipBlocksThisPlayer &&
      !skipMarkerActive);
  const videoEl = videoRef.current;
  const showLoadingOverlay =
    !state.hasError &&
    (!state.isLoaded ||
      (state.isBuffering && Boolean(videoEl && videoEl.readyState < 3)));

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [ctxSignInOpen, setCtxSignInOpen] = useState(false);
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (isReelCtx) return;
      e.preventDefault();
      if (!authPlayback) {
        setCtxSignInOpen(true);
        return;
      }
      setCtxMenu({ x: e.clientX, y: e.clientY });
    },
    [isReelCtx, authPlayback],
  );

  return (
    <div
      ref={containerRef}
      className={`relative bg-black overflow-hidden select-none ${isReelCtx ? 'z-[1]' : ''} ${className} player_inner`}
      style={{ cursor: showControls ? 'default' : tiltMode ? 'grab' : 'none' }}
      onContextMenu={handleContextMenu}
    >
      {ambientMode && authPlayback && !isMiniPlayerPortalActive && <AmbientBackground />}
      {/* Beat glow light: behind the video like ambient, soft-masked, no hard edges */}
      {authPlayback && !isMiniPlayerPortalActive && <StemGlowLight />}
      {/* Preload the seek-preview sprite sheet as a real (hidden) <img> as soon
          as the player mounts. A rendered <img> is fetched + decoded + retained
          by the browser, so the first scrub paints the preview instantly from
          cache  unlike a detached new Image() which can be dropped or
          deprioritized. */}
      {spriteSheetUrl && (
        <img
          src={spriteSheetUrl}
          alt=""
          aria-hidden
          decoding="async"
          className="pointer-events-none absolute h-px w-px opacity-0"
          style={{ left: -9999, top: -9999 }}
        />
      )}
      <PosterBackground
        onImageLoaded={handlePosterImageLoaded}
      />

      {statsForNerds && !isReelCtx && !inPipForThisVideo && <StatsForNerdsOverlay />}

      <div className="relative z-10 w-full h-full overflow-hidden" onTouchEnd={handleTouchEnd}>
        {state.hasError && <ErrorOverlay />}

        {/* On mobile with controls visible, the spinner lives INSIDE the
            center play/pause circle (ControlBar)  hide the full-screen one
            so we don't double-up. */}
        {showLoadingOverlay && !(isMobile && showControls) && <BufferingSpinner />}

        {showPlayPauseFeedback && !showSeekFeedback && !isReelCtx && !isMobile && !inPipForThisVideo && (
          <PlayPauseFeedback isPlaying={feedbackIconPlaying} fading={feedbackFading} />
        )}

        {showSeekFeedback && (!isReelCtx || embedReelControls) && !inPipForThisVideo && (
          <SeekFeedback direction={seekFeedbackDirection} seconds={seekFeedbackSeconds} fading={seekFeedbackFading} />
        )}

        {isMiniPlayerPortalActive && miniPlayerContainerRef.current
          ? createPortal(
              <div className="w-full h-full flex flex-col bg-black relative">
                <video
                  ref={assignVideoRef}
                  className="w-full flex-1 object-contain"
                  muted={muted}
                  loop={loopEnabled}
                  playsInline={playsInline}
                  preload="metadata"
                  onClick={handleVideoClick}
                  onDoubleClick={handleDoubleClick}
                  disableRemotePlayback={false}
                  {...({ 'x-webkit-airplay': 'allow' } as any)}
                />
                <CaptionOverlay containerRef={miniPlayerContainerRef} controlsVisible={false} compact />
                {showAudioVisualizer && (
                  <div className="shrink-0 px-3 pb-1 pt-0 pointer-events-none">
                    <AudioVisualizerBars anchorRef={miniPlayerContainerRef} />
                  </div>
                )}
                <div className="px-3 pb-2 pt-0 shrink-0">
                  <SeekBar />
                </div>
              </div>,
              miniPlayerContainerRef.current
            )
          : (
            <div
              className="w-full h-full flex items-center justify-center overflow-hidden"
              style={tiltMode ? {
                perspective: `${TILT_ROOM_PERSPECTIVE_PX}px`,
                perspectiveOrigin: `${50 + tiltRotation.y * 0.4}% ${50 - tiltRotation.x * 0.4}%`,
              } : undefined}
            >
              {/* World group: drag rotates the whole room (walls + screen),
                  so the parallax reads as looking around a room. */}
              <div
                className="w-full h-full relative"
                style={tiltMode ? tiltWorldStyle(tiltRotation) : undefined}
              >
              {tiltMode && <TiltRoomWalls zoom={tiltZoom} />}
              <video
                ref={assignVideoRef}
                className={`w-full h-full object-contain ${isReelCtx && !embedReelControls ? 'pointer-events-none' : ''}`}
                muted={muted}
                loop={loopEnabled}
                playsInline={playsInline}
                preload="metadata"
                onClick={handleVideoClick}
                onDoubleClick={handleDoubleClick}
                disableRemotePlayback={false}
                style={
                  tiltMode
                    ? {
                        ...tiltScreenStyle(tiltZoom),
                        boxShadow: `
                          0 ${6 + Math.abs(tiltRotation.x) * 0.7}px ${16 + Math.abs(tiltRotation.x) * 1.2}px rgba(0,0,0,0.55),
                          inset 0 0 0 1px rgba(255,255,255,0.07)
                        `,
                      }
                    : undefined
                }
                {...({ 'x-webkit-airplay': 'allow' } as any)}
                {...(isReelCtx ? { disablePictureInPicture: true, controlsList: 'nopictureinpicture noremoteplayback' } : {})}
              />
              {/* Specular reflection on the screen — angles with the world
                  rotation so the highlight slides as you orbit. */}
              {tiltMode && (
                <div
                  className="absolute inset-0 pointer-events-none z-[2] overflow-hidden"
                  style={{
                    ...tiltScreenStyle(tiltZoom, 1),
                    background: `linear-gradient(${135 + tiltRotation.y * 2.5}deg, rgba(255,255,255,${0.05 + Math.abs(tiltRotation.y) * 0.003}) 0%, transparent 45%), linear-gradient(to bottom, rgba(255,255,255,${0.02 + Math.abs(tiltRotation.x) * 0.001}) 0%, transparent 30%)`,
                  }}
                  aria-hidden
                />
              )}
              </div>
            </div>
          )}

        <TiltOverlay />
        <VideoKickBounce />
        <CaptionOverlay containerRef={containerRef} controlsVisible={showControls} />

        {/* Single end-of-video overlay. Replaces both the legacy full-screen
            EndScreen and the old API-backed EndCardOverlay. Renders only on
            `state.isEnded`, shows 2 centered suggestion cards adapted to
            the player size, embeds the auto-next countdown on the featured
            card, and lets the user replay or dismiss. Reel surfaces opt out
            via `isReel` inside the component itself. */}
        {!isReelCtx && !loopEnabled && (
          <EndCardOverlay
            suggestedVideos={relatedPlayQueue}
            seriesUpNextVideos={seriesPlayQueue}
            userActions={endScreenUserActions}
            currentUserId={currentUserId}
          />
        )}

        {isReelCtx && reelInfoSlot ? (
          <ReelInfoOverlay>{reelInfoSlot}</ReelInfoOverlay>
        ) : null}

        {(!isReelCtx || embedReelControls) && !isMiniPlayerPortalActive && (
          <div
            // YouTube-style asymmetric fade: controls snap in fast (100ms) and
            // leave a touch slower (200ms) — never the sluggish 300ms both ways.
            className={`absolute inset-0 z-[31] pointer-events-none transition-opacity ${showControls ? 'opacity-100 duration-100' : 'opacity-0 duration-200'}`}
            // When hidden (e.g. while the Skip Intro / Next Episode buttons are showing)
            // we MUST disable hit-testing for everything inside. `opacity-0` and
            // `pointer-events-none` on the wrapper are not enough  `ControlBar` puts
            // `pointer-events: auto` on its own strips (and the full mobile `inset-0`
            // overlay), so the invisible control bar would still intercept the click
            // a user makes on top of the Skip button. `inert` recursively kills focus,
            // pointer, and a11y for the subtree.
            inert={!showControls || undefined}
          >
            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />
            {/*
              This shell stays pointer-events-none so wheel/trackpad scroll reaches the page
              scroll_container over the video. ControlBar uses pointer-events auto only on its
              interactive strips (desktop bottom bar; mobile inset-0 + auto regions).
            */}
            <ControlBar
              onNext={hasNextControl ? handleNextVideo : undefined}
              nextVideo={hasNextControl ? nextVideoForTooltip : undefined}
              nextVideoBadge={hasNextControl ? nextVideoTooltipBadge : undefined}
              nextVideoCardCurrentUserId={currentUserId}
              nextVideoCardUserActions={endScreenUserActions}
              onPlayPauseClick={triggerPlayPauseFeedback}
              theaterMode={theaterMode}
              onTheaterModeChange={isMobileView ? undefined : handleTheaterModeChange}
              hideControls={effectiveHideControls}
              liftBottomPx={showAudioVisualizer ? visualizerStripPx : 0}
              isMobileLayout={isMobileView}
              onBack={onBack}
              tiltMode={tiltMode}
            />
          </div>
        )}

        {/* Visualizer lives OUTSIDE the fading control overlay so it stays on
            when the controls auto-hide. Controls are lifted above it via liftBottomPx. */}
        {showAudioVisualizer && !isMiniPlayerPortalActive && (
          // z-[32] for the spectrum strip; confetti portals into the player at z-[35]
          // so pops render in front of the video and controls.
          <div className="absolute bottom-0 left-0 right-0 z-[32] pointer-events-none">
            <PersistentBottomVisualizer />
          </div>
        )}

        {!isReelCtx && !inPipForThisVideo && !isMiniPlayerPortalActive && skipMarkers && (
          <SkipMarkerOverlay
            markers={skipMarkers}
            onSkipIntro={(t) => {
              const v = videoRef.current;
              if (v) v.currentTime = t;
            }}
            onNextEpisode={hasNextControl ? handleNextVideo : undefined}
            nextEpisode={hasNextControl ? nextVideoForTooltip ?? null : null}
            onActiveChange={setSkipMarkerActive}
          />
        )}

        {!isReelCtx && isSpatialAudioUiSupported() && (
          <SpatialAudioDialog
            open={spatialAudioDialogOpen}
            onOpenChange={setSpatialAudioDialogOpen}
            value={spatialAudio}
            onChange={setSpatialAudio}
          />
        )}

        {!isReelCtx && <PipOverlay />}


        {showPrompt && autoPlayEnabled && !isReelCtx && authPlayback && !inPipForThisVideo && (
          <AutoplayPrompt onEnable={enableAutoplay} onDismiss={dismissPrompt} />
        )}

        {showShortcuts && !isReelCtx && !inPipForThisVideo && (
          <ShortcutOverlay
            authPlaybackFeatures={authPlayback}
            onClose={() => setShowShortcuts(false)}
          />
        )}

        {guestLimitActive && !isReelCtx && guestWatchLimitSeconds != null && (
          <>
            <GuestPreviewNudge
              visible={nudgeVisible && !wallOpen}
              secondsRemaining={secondsRemaining}
              onDismiss={dismissNudge}
            />
            <GuestPreviewWall
              open={wallOpen}
              limitSeconds={guestWatchLimitSeconds}
              onDismiss={dismissWall}
            />
          </>
        )}
      </div>

      {!isReelCtx && authPlayback && ctxMenu && (
        <DropdownMenu open onOpenChange={(open) => { if (!open) setCtxMenu(null); }} modal={false}>
          <DropdownMenuTrigger asChild>
            <div
              aria-hidden
              style={{
                position: 'fixed',
                left: ctxMenu.x,
                top: ctxMenu.y,
                width: 1,
                height: 1,
                pointerEvents: 'none',
                opacity: 0,
              }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="bottom"
            align="start"
            sideOffset={4}
            collisionPadding={12}
            className="max-h-[min(72dvh,var(--radix-dropdown-menu-content-available-height))] min-w-[260px] max-w-[min(320px,calc(100vw-2rem))] z-[2147483647]"
          >
            <SettingsMenuBody />
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {!isReelCtx && !authPlayback && (
        <GuestPlaybackSignInDialog
          open={ctxSignInOpen}
          onOpenChange={setCtxSignInOpen}
          title="Sign in for player options"
          description="Playback speed, quality, theater mode, mini player, and other right-click settings are available when you're signed in."
        />
      )}
    </div>
  );
}


export default HLSPlayer;