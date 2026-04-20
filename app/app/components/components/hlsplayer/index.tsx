import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useInView } from 'react-intersection-observer';
import type { FileType } from '~/lib/types';
import { PlayerProvider, usePlayerContext, type ThumbnailSpriteMeta } from './PlayerContext';
import { FEED_EMBED_HIDE_CONTROLS, type HideControls } from './types';
import SeekBar from './controls/seek/SeekBar';
import PersistentBottomVisualizer from './controls/seek/PersistentBottomVisualizer';
import AudioVisualizerBars from './controls/seek/AudioVisualizerBars';
import { useHLS } from './hooks/useHLS';
import { useVideoEvents } from './hooks/useVideoEvents';
import { useMediaSession } from './hooks/useMediaSession';
import { usePlaybackPosition } from './hooks/usePlaybackPosition';
import { useAutoplay } from './hooks/useAutoplay';
import { useControlsVisibility } from './hooks/useControlsVisibility';
import { useFullscreen } from './hooks/useFullscreen';
import { useWakeLock } from './hooks/useWakeLock';
import ControlBar from './controls/ControlBar';
import EndScreen from './controls/endscreen/EndScreen';
import BufferingSpinner from './overlays/BufferingSpinner';
import ErrorOverlay from './overlays/ErrorOverlay';
import AutoplayPrompt from './overlays/AutoplayPrompt';
import PipOverlay from './overlays/PipOverlay';
import PlayPauseFeedback from './overlays/PlayPauseFeedback';
import SeekFeedback from './overlays/SeekFeedback';
import PosterBackground from './overlays/PosterBackground';
import ShortcutOverlay from './overlays/ShortcutOverlay';
import StatsForNerdsOverlay from './overlays/StatsForNerdsOverlay';
import AmbientBackground from '~/components/components/hlsplayer/overlays/AmbientBackground';
import GuestPreviewWall from '~/components/components/hlsplayer/overlays/GuestPreviewWall';
import GuestPreviewNudge from '~/components/components/hlsplayer/overlays/GuestPreviewNudge';
import { useGuestWatchLimit } from './hooks/useGuestWatchLimit';
import { usePictureInPictureContext } from '~/lib/Context/PictureInPictureContext';
import { useFileContext } from '~/lib/Context/Context';
import { useMiniPlayerContext } from '~/lib/Context/MiniPlayerContext';
import { isMobile } from 'react-device-detect';
import { getVideoSrc } from '~/lib/utils';
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
    <PlayerInner {...props} />
  </PlayerProvider>
);

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
}: HLSPlayerProps) {
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
    statsForNerds,
    autoPlay: autoPlayEnabled,
    loop: loopEnabled,
    authPlaybackFeatures: authPlayback,
    unlockPipReelAudio,
  } = usePlayerContext();

  /**
   * Reel / PiP vertical feed: observe the `<video>` like `ImageLoad` — virtual slides keep neighbors mounted.
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
    if (!embedReelControls) return hideControls;
    return { ...FEED_EMBED_HIDE_CONTROLS, ...hideControls };
  }, [embedReelControls, hideControls]);

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

  const showAudioVisualizer = audioVisualizer && !isMobile && authPlayback;

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
  /** Native / WebKit PiP uses this `<video>` — must not pause or block `play`. Document PiP uses a separate iframe. */
  const documentPipPausesMain = inPipForThisVideo && activePipKind === 'document';
  /** A different file is in PiP — pause this player so only one plays. */
  const otherVideoInPipBlocksThisPlayer =
    Boolean(isPipActive && pipContentId !== null && pipContentId !== imageID);
  const pipPauseMainPlayer = documentPipPausesMain || otherVideoInPipBlocksThisPlayer;
  const { miniPlayer, activateMiniPlayer: triggerMiniPlayer, containerRef: miniPlayerContainerRef, isPortalMode, containerReady, getNavigateBackTarget, sourceVideoRef: miniPlayerSourceVideoRef } = useMiniPlayerContext();

  const isMiniPlayerPortalActive = Boolean(
    miniPlayer && isPortalMode && file && miniPlayer.file?.unique_id === file.unique_id && containerReady && miniPlayerContainerRef.current
  );
  const callBackRef = useRef(callBack);
  callBackRef.current = callBack;
  const [mediaSessionImage, setMediaSessionImage] = useState<string | null>(null);
  const mediaSessionFileUidRef = useRef<string | undefined>(file?.unique_id);
  mediaSessionFileUidRef.current = file?.unique_id;

  useEffect(() => {
    setMediaSessionImage(null);
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
  const SEEK_SECONDS = 10;
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [visualizerLiftPx, setVisualizerLiftPx] = useState(0);

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
  useMediaSession(mediaSessionImage, videoRef);
  usePlaybackPosition(videoRef);
  useFullscreen();
  useWakeLock(videoRef);
  const autoplayAllowed =
    autoPlayEnabled && (!isReelCtx || reelVideoInView);
  const { showPrompt, enableAutoplay, dismissPrompt } = useAutoplay(
    autoplayAllowed,
    videoRef,
    { muteVideoWhenAutoplayDisabled: !unlockPipReelAudio },
  );
  useControlsVisibility();

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
    if (!reelVideoInView) {
      if (!v.paused) v.pause();
      if (!v.muted) v.muted = true;
    } else if (unlockPipReelAudio) {
      if (v.muted) v.muted = false;
    }
  }, [isReelCtx, reelVideoInView, unlockPipReelAudio, videoRef]);

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

  useEffect(() => {
    const prefix =
      file?.default_thumbnail && typeof file.default_thumbnail === 'string'
        ? file.default_thumbnail.replace(/[^/]+$/, '')
        : '';
    if (!prefix) return;
    const loadSpriteMeta = async () => {
      const metaUrl = `/api/load/image/${prefix}thumbnail_preview.json`;
      const spriteImgUrl = `/api/load/image/${prefix}thumbnail_preview.jpg`;
      try {
        const res = await fetch(metaUrl);
        if (!res.ok) return;
        const meta = (await res.json()) as ThumbnailSpriteMeta;
        if (meta?.cells?.length) {
          setSpriteMeta(meta);
          setSpriteUrl(spriteImgUrl);
        }
      } catch {}
    };
    loadSpriteMeta();
  }, [file?.default_thumbnail, setSpriteMeta, setSpriteUrl]);

  const performSeekByTap = useCallback(
    (clientX: number) => {
      const container = containerRef.current;
      const video = videoRef.current;
      if (!container || !video || (isReelCtx && !embedReelControls) || inPipForThisVideo) return;
      const rect = container.getBoundingClientRect();
      const x = clientX - rect.left;
      const width = rect.width;
      if (x < width / 3) {
        video.currentTime = Math.max(0, video.currentTime - SEEK_SECONDS);
        setSeekFeedbackDirection('back');
      } else if (x > (width * 2) / 3) {
        video.currentTime = Math.min(video.duration || 0, video.currentTime + SEEK_SECONDS);
        setSeekFeedbackDirection('forward');
      } else {
        return;
      }
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
        feedbackTimeoutRef.current = null;
      }
      setShowPlayPauseFeedback(false);
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
    [isReelCtx, embedReelControls, inPipForThisVideo]
  );

  const handleVideoClick = useCallback(() => {
    if (isReelCtx && !embedReelControls) return;
    if (inPipForThisVideo) return;
    if (isMobile && !embedReelControls) return;
    if (Date.now() - lastDoubleTapTimeRef.current < 300) return;
    if (reelEmbedAutoHide && !state.reelAuxiliaryChromeVisible) {
      setReelAuxiliaryChromeVisible(true);
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

  /** Prefer series order, then related — matches end-screen autoplay when `onNext` is not supplied. */
  const handleNextVideo = useCallback(() => {
    if (onNext) {
      onNext();
      return;
    }
    const next = seriesUpNextVideos?.[0] ?? suggestedVideos?.[0];
    if (next && onVideoSelect) onVideoSelect(next);
  }, [onNext, seriesUpNextVideos, suggestedVideos, onVideoSelect]);

  const hasNextControl =
    typeof onNext === "function" ||
    (!!onVideoSelect && !!(seriesUpNextVideos?.[0] || suggestedVideos?.[0]));

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (isReelCtx && !embedReelControls) return;
      if (inPipForThisVideo) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
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
    [isReelCtx, embedReelControls, inPipForThisVideo, performSeekByTap]
  );

  useEffect(() => {
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
        case 'j':
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 5);
          break;
        case 'ArrowRight':
        case 'l':
          e.preventDefault();
          video.currentTime = Math.min(video.duration, video.currentTime + 5);
          break;
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
          if (isMobileView) break;
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
          e.preventDefault();
          if (file && video) {
            const backTarget = getNavigateBackTarget();
            miniPlayerSourceVideoRef.current = video;
            triggerMiniPlayer(
              {
                src: src || getVideoSrc(file.endpoint ?? '', file.file_type),
                file,
                currentTime: video.currentTime,
                imageID: imageID || file.unique_id,
                wasPlaying: !video.paused,
                volume: video.volume,
                muted: video.muted,
                playbackRate: video.playbackRate,
              },
              { navigateTo: backTarget }
            );
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
  }, [isReelCtx, embedReelControls, inPipForThisVideo, togglePlay, triggerPlayPauseFeedback, theaterMode, handleTheaterModeChange, isMobileView, setPlaybackRate, showShortcuts, file, src, imageID, triggerMiniPlayer, getNavigateBackTarget, miniPlayerSourceVideoRef]);

  /** Feed embed reel: outer chrome stays visible; ControlBar shows seek-only vs full via `reelAuxiliaryChromeVisible`. */
  const showControls =
    embedReelControls ||
    (state.controlsVisible &&
      !isReelCtx &&
      !inPipForThisVideo &&
      !otherVideoInPipBlocksThisPlayer);
  const videoEl = videoRef.current;
  const showLoadingOverlay =
    !state.hasError &&
    (!state.isLoaded ||
      (state.isBuffering && Boolean(videoEl && videoEl.readyState < 3)));

  return (
    <div
      ref={containerRef}
      className={`relative bg-black overflow-hidden select-none ${isReelCtx ? 'z-[1]' : ''} ${className}`}
      style={{ cursor: 'default' }}
    >
      {ambientMode && authPlayback && <AmbientBackground />}
      <PosterBackground
        onImageLoaded={handlePosterImageLoaded}
      />

      {statsForNerds && !isReelCtx && !inPipForThisVideo && <StatsForNerdsOverlay />}

      <div className="relative z-10 w-full h-full" onTouchEnd={handleTouchEnd}>
        {state.hasError && <ErrorOverlay />}

        {showLoadingOverlay && <BufferingSpinner />}

        {showPlayPauseFeedback && !showSeekFeedback && !isReelCtx && !isMobile && !inPipForThisVideo && (
          <PlayPauseFeedback isPlaying={feedbackIconPlaying} fading={feedbackFading} />
        )}

        {showSeekFeedback && (!isReelCtx || embedReelControls) && !inPipForThisVideo && (
          <SeekFeedback direction={seekFeedbackDirection} seconds={SEEK_SECONDS} fading={seekFeedbackFading} />
        )}

        {isMiniPlayerPortalActive && miniPlayerContainerRef.current
          ? createPortal(
              <div className="w-full h-full flex flex-col bg-black">
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
                {showAudioVisualizer && (
                  <div className="shrink-0 px-3 pb-1 pt-0 pointer-events-none">
                    <AudioVisualizerBars />
                  </div>
                )}
                <div className="px-3 pb-2 pt-0 shrink-0">
                  <SeekBar />
                </div>
              </div>,
              miniPlayerContainerRef.current
            )
          : (
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
              {...({ 'x-webkit-airplay': 'allow' } as any)}
              {...(isReelCtx ? { disablePictureInPicture: true, controlsList: 'nopictureinpicture noremoteplayback' } : {})}
            />
          )}

        {!isReelCtx && !loopEnabled && (
          <EndScreen
            suggestedVideos={suggestedVideos}
            seriesUpNextVideos={seriesUpNextVideos}
            userActions={endScreenUserActions}
            currentUserId={currentUserId}
          />
        )}

        {(!isReelCtx || embedReelControls) && !isMiniPlayerPortalActive && (
          <div
            className={`transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          >
            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />
            <ControlBar
              onNext={hasNextControl ? handleNextVideo : undefined}
              onPlayPauseClick={triggerPlayPauseFeedback}
              theaterMode={theaterMode}
              onTheaterModeChange={isMobileView ? undefined : handleTheaterModeChange}
              hideControls={effectiveHideControls}
              liftBottomPx={showAudioVisualizer ? visualizerLiftPx : 0}
              isMobileLayout={isMobileView}
              onBack={onBack}
            />
          </div>
        )}

        {!isReelCtx && <PipOverlay />}

        {showAudioVisualizer && !isReelCtx && !isMiniPlayerPortalActive && !inPipForThisVideo && (
          <PersistentBottomVisualizer onLayoutHeight={setVisualizerLiftPx} />
        )}

        {showPrompt && autoPlayEnabled && !isReelCtx && authPlayback && !inPipForThisVideo && (
          <AutoplayPrompt onEnable={enableAutoplay} onDismiss={dismissPrompt} />
        )}

        {showShortcuts && !isReelCtx && !inPipForThisVideo && (
          <ShortcutOverlay onClose={() => setShowShortcuts(false)} />
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
    </div>
  );
}

export default HLSPlayer;