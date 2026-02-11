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
import PosterBackground from './overlays/PosterBackground';
import AmbientBackground from '~/components/components/hlsplayer/overlays/AmbientBackground';
import { usePictureInPictureContext } from '~/lib/Context/PictureInPictureContext';
import { getRandomThumbnail } from '~/lib/utils';

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
  theaterMode?: boolean;
  onTheaterModeChange?: (active: boolean) => void;
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
  theaterMode = false,
  onTheaterModeChange,
}: HLSPlayerProps) {
  const {
    videoRef,
    containerRef,
    state,
    setState,
    togglePlay,
    isReel: isReelCtx,
    setSpriteMeta,
    setSpriteUrl,
    ambientMode,
    autoPlay: autoPlayEnabled,
    loop: loopEnabled,
  } = usePlayerContext();

  const { isPipActive, isContentInPip } = usePictureInPictureContext();
  const [mediaSessionImage, setMediaSessionImage] = useState<string | null>(null);
  const [showPlayPauseFeedback, setShowPlayPauseFeedback] = useState(false);
  const [feedbackFading, setFeedbackFading] = useState(false);
  const [feedbackIconPlaying, setFeedbackIconPlaying] = useState(true);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  }, []);

  useHLS();
  useVideoEvents({ onPlay, onPause, onEnded, onError });
  useMediaSession(mediaSessionImage);
  usePlaybackPosition();
  useFullscreen();
  const { showPrompt, enableAutoplay, dismissPrompt } = useAutoplay(autoPlayEnabled);
  useControlsVisibility();

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

  const handleVideoClick = useCallback(() => {
    if (isReelCtx) return;
    togglePlay();
    triggerPlayPauseFeedback();
  }, [isReelCtx, togglePlay, triggerPlayPauseFeedback]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (isReelCtx) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const video = videoRef.current;
    if (!video) return;
    if (x < rect.width / 3) {
      video.currentTime = Math.max(0, video.currentTime - 10);
    } else if (x > (rect.width * 2) / 3) {
      video.currentTime = Math.min(video.duration, video.currentTime + 10);
    }
  }, [isReelCtx]);

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
        case 'f':
          e.preventDefault();
          if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
          } else {
            containerRef.current?.requestFullscreen().catch(() => {});
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isReelCtx, togglePlay, triggerPlayPauseFeedback]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || isReelCtx) return;
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden' && !video.paused) {
        video.pause();
      } else if (document.visibilityState === 'visible' && autoPlayEnabled && video.paused && !state.isEnded) {
        video.play().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [autoPlayEnabled, isReelCtx, state.isEnded]);

  useEffect(() => {
    const savedVol = safeGet('player-volume');
    const savedSpeed = safeGet('player-speed');
    const savedMuted = safeGet('player-muted');
    const video = videoRef.current;
    if (!video) return;
    if (savedVol) {
      const v = parseFloat(savedVol);
      if (!isNaN(v)) { video.volume = v; setState(s => ({ ...s, volume: v })); }
    }
    if (!isReelCtx && savedMuted !== null) {
      const muted = savedMuted === 'true';
      video.muted = muted;
      setState(s => ({ ...s, isMuted: muted }));
    }
    if (savedSpeed) {
      const s = parseFloat(savedSpeed);
      if (!isNaN(s)) { video.playbackRate = s; setState(s2 => ({ ...s2, playbackRate: s })); }
    }
  }, [isReelCtx]);

  const showControls = state.controlsVisible && !isReelCtx;
  const showBuffer = state.isBuffering && !state.isLoaded || (state.isBuffering && videoRef.current && videoRef.current.readyState < 3);

  return (
    <div
      ref={containerRef}
      className={`relative bg-black overflow-hidden select-none ${isReelCtx ? 'z-[1]' : ''} ${className}`}
      style={{ cursor: showControls ? 'default' : 'none' }}
    >
      {/* Ambient gradient at the very back of the player (spread, behind poster & video) */}
      {ambientMode && <AmbientBackground />}
      <PosterBackground
        onImageLoaded={(imgSrc, colors) => {
          setMediaSessionImage(imgSrc);
          callBack?.({ src: imgSrc, colors });
        }}
      />

      <div className="relative z-10 w-full h-full">
        {state.hasError && <ErrorOverlay />}

        {showBuffer && <BufferingSpinner />}

        <PipOverlay />

        {showPlayPauseFeedback && !isReelCtx && (
          <PlayPauseFeedback isPlaying={feedbackIconPlaying} fading={feedbackFading} />
        )}

        <video
          ref={videoRef}
          className={`w-full h-full object-contain ${
            isReelCtx ? 'pointer-events-none' : ''
          } ${isPipActive && isContentInPip(imageID) ? 'opacity-0' : ''}`}
          muted={muted}
          loop={loopEnabled}
          playsInline={playsInline}
          preload="metadata"
          onClick={handleVideoClick}
          onDoubleClick={handleDoubleClick}
          {...(isReelCtx ? { disablePictureInPicture: true, controlsList: 'nopictureinpicture' } : {})}
        />

        {!isReelCtx && !loopEnabled && (
          <EndScreen
            suggestedVideos={suggestedVideos}
            onVideoSelect={onVideoSelect}
          />
        )}

        {!isReelCtx && (
          <div
            className={`transition-opacity duration-300 ${
              showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />
            <ControlBar onNext={onNext} theaterMode={theaterMode} onTheaterModeChange={onTheaterModeChange} onPlayPauseClick={triggerPlayPauseFeedback} />
          </div>
        )}

        {showPrompt && autoPlayEnabled && !isReelCtx && (
          <AutoplayPrompt onEnable={enableAutoplay} onDismiss={dismissPrompt} />
        )}
      </div>
    </div>
  );
}

function safeGet(key: string): string | null {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null; } catch { return null; }
}

export default HLSPlayer;
