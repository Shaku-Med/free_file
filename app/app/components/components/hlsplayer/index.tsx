import React, { useEffect, useState, useCallback, useRef } from 'react';
import type { FileType } from '~/lib/types';
import { PlayerProvider, usePlayerContext, type ThumbnailSpriteMeta } from './PlayerContext';
import { useHLS } from './hooks/useHLS';
import { useVideoEvents } from './hooks/useVideoEvents';
import { useMediaSession } from './hooks/useMediaSession';
import { usePlaybackPosition } from './hooks/usePlaybackPosition';
import { useAutoplay } from './hooks/useAutoplay';
import { useControlsVisibility } from './hooks/useControlsVisibility';
import { useFullscreen } from './hooks/useFullscreen';
import ControlBar from './controls/ControlBar';
import EndScreen from './controls/endscreen/EndScreen';
import BufferingSpinner from './overlays/BufferingSpinner';
import ErrorOverlay from './overlays/ErrorOverlay';
import AutoplayPrompt from './overlays/AutoplayPrompt';
import PipOverlay from './overlays/PipOverlay';
import PlayPauseFeedback from './overlays/PlayPauseFeedback';
import SeekFeedback from './overlays/SeekFeedback';
import PosterBackground from './overlays/PosterBackground';
import AmbientBackground from '~/components/components/hlsplayer/overlays/AmbientBackground';
import { usePictureInPictureContext } from '~/lib/Context/PictureInPictureContext';
import { useFileContext } from '~/lib/Context/Context';
import { isMobile } from 'react-device-detect';

interface CallBackProps {
  src: string;
  colors: string[];
}

interface HLSPlayerProps {
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
  onVideoSelect?: (video: FileType) => void;
  onNext?: () => void;
  videoRef: React.RefObject<HTMLVideoElement>;
  onAmbientModeChange?: (active: boolean) => void;
}

const HLSPlayer: React.FC<HLSPlayerProps> = (props) => {
  return (
    <PlayerProvider
      src={props.src}
      file={props.file ?? null}
      imageID={props.imageID ?? ''}
      isReel={props.isReel ?? false}
      loop={props.loop ?? false}
      initialMuted={props.muted ?? false}
      initialAutoPlay={props.autoPlay ?? false}
      videoRef={props.videoRef}
    >
      <PlayerInner {...props} />
    </PlayerProvider>
  );
};

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
  onVideoSelect,
  onNext,
  videoRef,
  onAmbientModeChange,
}: HLSPlayerProps) {
  const { theaterMode, setTheaterMode, setPlayerSettings, savePlayerSettings } = useFileContext();
  const {
    containerRef,
    state,
    setState,
    togglePlay,
    setPlaybackRate,
    isReel: isReelCtx,
    setSpriteMeta,
    setSpriteUrl,
    ambientMode,
    autoPlay: autoPlayEnabled,
    loop: loopEnabled,
  } = usePlayerContext();

  const [isMobileView, setIsMobileView] = useState(isMobile);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobileView(isMobile || mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  const { isPipActive, isContentInPip } = usePictureInPictureContext();
  const callBackRef = useRef(callBack);
  callBackRef.current = callBack;
  const [mediaSessionImage, setMediaSessionImage] = useState<string | null>(null);
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

  const triggerPlayPauseFeedback = useCallback(() => {
    if (isReelCtx) return;
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
  const { showPrompt, enableAutoplay, dismissPrompt } = useAutoplay(autoPlayEnabled, videoRef);
  useControlsVisibility();

  const handleTheaterModeChange = useCallback(
    (active: boolean) => {
      setTheaterMode(active);
      setPlayerSettings(prev => (prev ? { ...prev, theaterMode: active } : prev));
      savePlayerSettings({ theaterMode: active }).catch(() => {});
    },
    [setTheaterMode, setPlayerSettings, savePlayerSettings]
  );

  const handlePosterImageLoaded = useCallback((imgSrc: string, colors: string[]) => {
    setMediaSessionImage(imgSrc);
    callBackRef.current?.({ src: imgSrc, colors });
  }, []);

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
      file?.thumbnails?.length && typeof file.thumbnails[0] === 'string'
        ? file.thumbnails[0].replace(/[^/]+$/, '')
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
  }, [file?.thumbnails, setSpriteMeta, setSpriteUrl]);

  const performSeekByTap = useCallback(
    (clientX: number) => {
      const container = containerRef.current;
      const video = videoRef.current;
      if (!container || !video || isReelCtx) return;
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
    [isReelCtx]
  );

  const handleVideoClick = useCallback(() => {
    if (isReelCtx) return;
    if (Date.now() - lastDoubleTapTimeRef.current < 300) return;
    togglePlay();
    triggerPlayPauseFeedback();
  }, [isReelCtx, togglePlay, triggerPlayPauseFeedback]);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isReelCtx) return;
      e.preventDefault();
      lastDoubleTapTimeRef.current = Date.now();
      performSeekByTap(e.clientX);
    },
    [isReelCtx, performSeekByTap]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (isReelCtx) return;
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
    [isReelCtx, performSeekByTap]
  );

  useEffect(() => {
    if (isReelCtx) return;
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const video = videoRef.current;
      if (!video) return;

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
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isReelCtx, togglePlay, triggerPlayPauseFeedback, theaterMode, handleTheaterModeChange, isMobileView, setPlaybackRate]);

  const showControls = state.controlsVisible && !isReelCtx;
  const showBuffer = state.isBuffering && !state.isLoaded || (state.isBuffering && videoRef.current && videoRef.current.readyState < 3);

  return (
    <div
      ref={containerRef}
      className={`relative bg-black overflow-hidden select-none ${isReelCtx ? 'z-[1]' : ''} ${className}`}
      style={{ cursor: showControls ? 'default' : 'none' }}
    >
      {ambientMode && <AmbientBackground />}
      <PosterBackground
        onImageLoaded={handlePosterImageLoaded}
      />

      <div className="relative z-10 w-full h-full" onTouchEnd={handleTouchEnd}>
        {state.hasError && <ErrorOverlay />}

        {showBuffer && <BufferingSpinner />}

        <PipOverlay />

        {showPlayPauseFeedback && !showSeekFeedback && !isReelCtx && (
          <PlayPauseFeedback isPlaying={feedbackIconPlaying} fading={feedbackFading} />
        )}

        {showSeekFeedback && !isReelCtx && (
          <SeekFeedback direction={seekFeedbackDirection} seconds={SEEK_SECONDS} fading={seekFeedbackFading} />
        )}

        <video
          ref={videoRef}
          className={`w-full h-full object-contain ${isReelCtx ? 'pointer-events-none' : ''} ${isPipActive && isContentInPip(imageID) ? 'opacity-0' : ''}`}
          muted={muted}
          loop={loopEnabled}
          playsInline={playsInline}
          preload="metadata"
          onClick={handleVideoClick}
          onDoubleClick={handleDoubleClick}
          disableRemotePlayback={false}
          {...(isReelCtx ? { disablePictureInPicture: true, controlsList: 'nopictureinpicture noremoteplayback' } : {})}
        />

        {!isReelCtx && !loopEnabled && (
          <EndScreen
            suggestedVideos={suggestedVideos}
          />
        )}

        {!isReelCtx && (
          <div
            className={`transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          >
            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />
            <ControlBar
              onNext={onNext}
              onPlayPauseClick={triggerPlayPauseFeedback}
              theaterMode={theaterMode}
              onTheaterModeChange={isMobileView ? undefined : handleTheaterModeChange}
            />
          </div>
        )}

        {showPrompt && autoPlayEnabled && !isReelCtx && (
          <AutoplayPrompt onEnable={enableAutoplay} onDismiss={dismissPrompt} />
        )}
      </div>
    </div>
  );
}

export default HLSPlayer;