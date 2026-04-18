import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { createPortal } from 'react-dom';
import { X, Maximize2, Loader2 } from 'lucide-react';
import { useMiniPlayerContext } from '~/lib/Context/MiniPlayerContext';
import { ParseFilename } from '~/lib/utils';
import { cn } from '~/lib/utils';
import HLSPlayer from '~/components/components/hlsplayer';
import { MINI_PLAYER_HIDE_CONTROLS } from '~/components/components/hlsplayer/types';
import { getVideoSrc } from '~/lib/utils';
import { useMiniPlayerDrag } from './useMiniPlayerDrag';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';

function MiniPlayerContent() {
  const {
    miniPlayer,
    closeMiniPlayer,
    containerRef,
    setContainerReady,
    pendingNavigateTo,
    clearPendingNavigate,
    isExpanding,
    startExpand,
    sourceVideoRef,
  } = useMiniPlayerContext();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const {
    elementRef,
    position,
    isSnapping,
    mounted,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    didDragRef,
  } = useMiniPlayerDrag();
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (miniPlayer) setContainerReady(true);
    return () => setContainerReady(false);
  }, [miniPlayer, setContainerReady]);

  // Apply the carried playback state (volume, muted, playbackRate, play/pause)
  // directly to the video element once it's ready, overriding saved player settings.
  // Once the mini player is playing, mute the source (large) video, then navigate.
  const appliedStateRef = useRef(false);
  useEffect(() => {
    if (!miniPlayer || appliedStateRef.current) return;
    const video = videoRef.current;
    if (!video) return;

    const apply = async () => {
      if (appliedStateRef.current) return;
      appliedStateRef.current = true;
      video.volume = miniPlayer.volume;
      video.muted = miniPlayer.muted;
      video.playbackRate = miniPlayer.playbackRate;

      if (miniPlayer.wasPlaying) {
        try { await video.play(); } catch {}
      } else {
        video.pause();
      }

      // Mini player is now playing — mute the large video so there's no overlap
      if (sourceVideoRef.current) {
        sourceVideoRef.current.muted = true;
        sourceVideoRef.current = null;
      }

      // Safe to navigate away from the original route
      if (pendingNavigateTo) {
        navigate(pendingNavigateTo);
        clearPendingNavigate();
      }
    };

    if (video.readyState >= 2) {
      apply();
    } else {
      video.addEventListener('canplay', apply, { once: true });
      return () => video.removeEventListener('canplay', apply);
    }
  }, [miniPlayer, videoRef, pendingNavigateTo, navigate, clearPendingNavigate, sourceVideoRef]);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      closeMiniPlayer();
      setClosing(false);
    }, 200);
  }, [closeMiniPlayer]);

  const handleExpand = useCallback(() => {
    if (!miniPlayer || isExpanding) return;
    const video = videoRef.current;
    // Capture current mini player state to hand off to the main player
    startExpand({
      fileId: miniPlayer.file.unique_id,
      currentTime: video?.currentTime ?? miniPlayer.currentTime,
      volume: video?.volume ?? miniPlayer.volume,
      muted: video?.muted ?? miniPlayer.muted,
      playbackRate: video?.playbackRate ?? miniPlayer.playbackRate,
      wasPlaying: video ? !video.paused : miniPlayer.wasPlaying,
    });
    navigate(`/${miniPlayer.file.unique_id}`);
  }, [miniPlayer, isExpanding, startExpand, navigate, videoRef]);

  if (!miniPlayer) return null;

  const title = miniPlayer.file.file_title || ParseFilename(miniPlayer.file.filename);
  const titleStr = typeof title === 'string' ? title : (title as string[]).join('');

  return (
    <div
      ref={elementRef}
      data-mini-player
      className={cn(
        'fixed z-[2147483647] rounded-xl overflow-hidden bg-muted border border-border',
        'w-[min(340px,calc(100vw-1.5rem))]',
        closing && 'opacity-0 scale-95 translate-y-3',
        !closing && mounted && 'opacity-100 scale-100 translate-y-0',
        !mounted && 'opacity-0',
        'shadow-[0_8px_32px_rgba(0,0,0,0.55),0_2px_8px_rgba(0,0,0,0.35)]',
      )}
      style={{
        left: position.x,
        top: position.y,
        isolation: 'isolate',
        transition: isSnapping
          ? 'left 380ms cubic-bezier(0.34,1.56,0.64,1), top 380ms cubic-bezier(0.34,1.56,0.64,1), opacity 200ms ease, transform 200ms ease'
          : mounted
            ? 'opacity 200ms ease, transform 200ms ease'
            : 'none',
        willChange: 'left, top, opacity, transform',
      }}
    >
      {/* ─── Top bar: drag handle + expand + close ─── */}
      <div
        className="flex items-center h-9 px-1.5 cursor-grab active:cursor-grabbing bg-muted touch-none select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        aria-label="Drag to move mini player"
      >
        {/* Expand / maximize — shows loader while waiting for main player */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex shrink-0">
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); handleExpand(); }}
                disabled={isExpanding}
                className={cn(
                  'relative shrink-0 w-8 h-8 flex items-center justify-center rounded-full transition-colors touch-manipulation',
                  isExpanding
                    ? 'text-white/50 cursor-wait'
                    : 'text-white/70 hover:text-white hover:bg-white/10 active:bg-white/20'
                )}
                aria-label={isExpanding ? 'Loading full player...' : 'Expand to full player'}
              >
                {isExpanding ? (
                  <Loader2 className="w-[15px] h-[15px] animate-spin" />
                ) : (
                  <Maximize2 className="w-[15px] h-[15px]" />
                )}
              </button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            {isExpanding ? 'Waiting for the full player to load…' : 'Expand'}
          </TooltipContent>
        </Tooltip>

        {/* Drag indicator pill */}
        <div className="flex-1 flex justify-center">
          <div className="w-8 h-[3px] rounded-full bg-white/20" />
        </div>

        {/* Close */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); handleClose(); }}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10 active:bg-white/20 transition-colors touch-manipulation"
              aria-label="Close mini player"
            >
              <X className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Close</TooltipContent>
        </Tooltip>
      </div>

      {/* ─── Video area ─── */}
      <div
        ref={containerRef}
        className="relative aspect-video w-full bg-black overflow-hidden"
      >
        <HLSPlayer
          videoRef={videoRef}
          src={getVideoSrc(miniPlayer.file.endpoint ?? '', miniPlayer.file.file_type)}
          imageID={miniPlayer.imageID}
          file={miniPlayer.file}
          className="w-full h-full"
          muted={miniPlayer.muted}
          playsInline
          startTime={miniPlayer.currentTime}
          hideControls={MINI_PLAYER_HIDE_CONTROLS}
        />
      </div>

      {/* ─── Info footer ─── */}
      <div className="px-3 py-2.5 bg-muted">
        <p className="text-white/90 text-xs font-medium truncate leading-snug">{titleStr}</p>
        {miniPlayer.file.owner?.username && (
          <p className="text-white/40 text-[11px] truncate mt-0.5">{miniPlayer.file.owner.username}</p>
        )}
      </div>
    </div>
  );
}

export default function MiniPlayer() {
  const { miniPlayer } = useMiniPlayerContext();

  if (!miniPlayer) return null;

  return createPortal(
    <MiniPlayerContent />,
    document.body
  );
}
