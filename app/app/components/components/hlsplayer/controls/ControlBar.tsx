import { useRef, useState, useEffect, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Play, Pause, SkipForward, MoreVertical, SkipBack, ChevronLeft, X } from 'lucide-react';
import { usePlayerContext } from '../PlayerContext';
import { useControlBarWidth } from '../hooks/useControlBarWidth';
import SeekBar from './seek/SeekBar';
import VolumeControl from './volume/VolumeControl';
import SettingsMenu from './settings/SettingsMenu';
import TheaterButton from './theater/TheaterButton';
import FullscreenButton from './fullscreen/FullscreenButton';
import CastButton from './cast/CastButton';
import SubtitleButton from './subtitles/SubtitleButton';
import MiniPlayerButton from './miniplayer/MiniPlayerButton';
import GuestPlaybackBenefitsDialog from './GuestPlaybackBenefitsDialog';
import PipButton from './pip/PipButton';
import { formatTime } from './seek/functions/formatTime';
import type { HideControls } from '../types';
import { isMobile } from 'react-device-detect';
import { cn } from '~/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';
import type { FileType } from '~/lib/types';
import VideoCard from '~/routes/Home/components/VideoCard';

const isHidden = (hide?: HideControls, key?: keyof NonNullable<HideControls>) =>
  !!(hide && key && hide[key]);

const DROPDOWN_GAP = 8;
const VIEWPORT_PADDING = 16;
const MIN_SPACE_BELOW_TO_OPEN_DOWN = 320;
const DROPDOWN_MAX_HEIGHT_RATIO = 0.55;
const MOBILE_SKIP_SEC = 10;
const CTRL_TIP_MS = 350;

function PlayerControlTooltip({
  label,
  side = 'top',
  children,
}: {
  label: string;
  side?: 'top' | 'bottom';
  children: ReactElement;
}) {
  return (
    <Tooltip delayDuration={CTRL_TIP_MS}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}

function NextVideoTooltipButton({
  onClick,
  className,
  children,
  nextVideo,
  nextVideoBadge,
  nextVideoCardCurrentUserId,
  nextVideoCardUserActions,
  ariaLabel,
}: {
  onClick: (e: React.MouseEvent) => void;
  className: string;
  children: React.ReactNode;
  nextVideo?: FileType;
  nextVideoBadge?: string;
  nextVideoCardCurrentUserId?: string;
  nextVideoCardUserActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
  ariaLabel: string;
}) {
  const title = nextVideo?.file_title?.trim() || nextVideo?.filename;
  const button = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className={className}
      aria-label={title ? `${ariaLabel}: ${title}` : ariaLabel}
    >
      {children}
    </button>
  );

  if (!nextVideo) {
    return (
      <Tooltip delayDuration={CTRL_TIP_MS}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="top">{ariaLabel}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip delayDuration={220}>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={10}
        className="max-h-[min(72vh,440px)] w-[min(94vw,26rem)] max-w-[min(94vw,26rem)] overflow-x-hidden overflow-y-auto p-0"
      >
        {nextVideoBadge ? (
          <div className="border-b border-border/50 bg-muted/25 px-3 py-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {nextVideoBadge}
            </p>
          </div>
        ) : null}
        <div className="min-w-0" onClick={(e) => e.stopPropagation()}>
          <VideoCard
            data={nextVideo}
            layout="horizontal"
            related
            hideActions={{completely: true}}
            currentUserId={nextVideoCardCurrentUserId}
            userActions={nextVideoCardUserActions}
          />
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

interface ControlBarProps {
  onNext?: () => void;
  /** Real `VideoCard` (horizontal) in the next control tooltip when the target is known. */
  nextVideo?: FileType;
  nextVideoBadge?: string;
  nextVideoCardCurrentUserId?: string;
  nextVideoCardUserActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
  theaterMode?: boolean;
  onTheaterModeChange?: (active: boolean) => void;
  onPlayPauseClick?: () => void;
  hideControls?: HideControls;
  liftBottomPx?: number;
  isMobileLayout?: boolean;
  /** Shown as a chevron back control when set, unless `hideControls.back`. */
  onBack?: () => void;
  /** Rendered at the very bottom of the control bar flex-col (e.g. audio visualizer). */
  bottomSlot?: React.ReactNode;
  /** When true the parent overlay is pointer-events-none; the bar re-enables on itself. */
  tiltMode?: boolean;
}

export default function ControlBar({
  onNext,
  nextVideo,
  nextVideoBadge,
  nextVideoCardCurrentUserId,
  nextVideoCardUserActions,
  theaterMode = false,
  onTheaterModeChange,
  onPlayPauseClick,
  hideControls,
  liftBottomPx = 0,
  isMobileLayout = false,
  onBack,
  bottomSlot,
  tiltMode = false,
}: ControlBarProps) {
  const {
    state,
    togglePlay,
    seek,
    videoRef,
    autoPlay,
    setAutoPlay,
    authPlaybackFeatures,
    reelEmbedAutoHide,
    tiltRotation,
    tiltZoom,
    resetTiltRotation,
  } = usePlayerContext();

  const idleSeekOnly = reelEmbedAutoHide && !state.reelAuxiliaryChromeVisible;
  const showTiltReset = tiltMode && (tiltRotation.x !== 0 || tiltRotation.y !== 0 || tiltRotation.z !== 0 || tiltZoom !== 1);
  const containerRef = useRef<HTMLDivElement>(null);
  const { showTime, showRightInline, showVolumeSlider } = useControlBarWidth(containerRef);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    maxHeight?: number;
  }>({ left: 0 });

  useEffect(() => {
    if (!overflowOpen || !moreButtonRef.current) return;
    const btn = moreButtonRef.current.getBoundingClientRect();
    const dropdownWidth = 280;
    const padding = VIEWPORT_PADDING;
    let left = btn.right - dropdownWidth;
    left = Math.max(padding, Math.min(left, window.innerWidth - dropdownWidth - padding));
    const spaceBelow = window.innerHeight - btn.bottom - DROPDOWN_GAP - padding;
    const spaceAbove = btn.top - DROPDOWN_GAP - padding;
    const openAbove = spaceBelow < MIN_SPACE_BELOW_TO_OPEN_DOWN || spaceAbove > spaceBelow;
    const maxHeight = Math.min(
      openAbove ? spaceAbove : spaceBelow,
      window.innerHeight * DROPDOWN_MAX_HEIGHT_RATIO
    );
    setDropdownStyle(
      openAbove
        ? { bottom: window.innerHeight - btn.top + DROPDOWN_GAP, left, maxHeight }
        : { top: btn.bottom + DROPDOWN_GAP, left, maxHeight }
    );
  }, [overflowOpen]);

  useEffect(() => {
    if (!overflowOpen) return;
    const handle = (e: MouseEvent) => {
      const target = e.target as Node;
      const inOverflow = overflowRef.current?.contains(target);
      const inMoreBtn = moreButtonRef.current?.contains(target);
      if (!inOverflow && !inMoreBtn) setOverflowOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [overflowOpen]);

  const skipBack = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    seek(Math.max(0, v.currentTime - MOBILE_SKIP_SEC));
  };

  const skipForward = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    seek(Math.min(v.duration || 0, v.currentTime + MOBILE_SKIP_SEC));
  };

  const handleNextTap = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    onNext?.();
  };

  const circleBtn =
    'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/50 text-white shadow-sm active:scale-95 transition-transform';

  const desktopIconCircle =
    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/50 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-black/60';

  const desktopRightPill =
    'flex max-w-[min(100%,28rem)] items-center gap-0.5 overflow-x-auto rounded-full bg-black/50 px-1.5 py-1 shadow-sm backdrop-blur-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

  if (idleSeekOnly) {
    if (isMobileLayout) {
      return (
        <div
          ref={containerRef}
          className="pointer-events-none absolute inset-0 z-30 flex flex-col"
          style={{ bottom: liftBottomPx }}
        >
          <div
            className="pointer-events-auto absolute bottom-0 left-0 right-0 z-40 flex flex-col px-3 pb-3 pt-2"
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
          >
            {!isHidden(hideControls, 'seek') && <SeekBar mobileStyle />}
          </div>
        </div>
      );
    }
    return (
      <div
        ref={containerRef}
        className={`absolute left-0 right-0 z-30 flex flex-col ${tiltMode ? 'pointer-events-auto' : ''}`}
        style={{ bottom: liftBottomPx }}
      >
        {!isHidden(hideControls, 'seek') && (
          <div className="px-3 pb-2 pt-1">
            <SeekBar />
          </div>
        )}
      </div>
    );
  }

  if (isMobileLayout) {
    return (
      <div
        ref={containerRef}
        className="pointer-events-none absolute inset-0 z-30 flex flex-col"
        style={{ bottom: liftBottomPx }}
      >
        {onBack && !isHidden(hideControls, 'back') && (
          <div className="pointer-events-auto absolute left-3 top-3 z-40">
            <PlayerControlTooltip label="Back" side="bottom">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onBack();
                }}
                className={desktopIconCircle}
                aria-label="Back"
              >
                <ChevronLeft className="h-5 w-5 text-white" />
              </button>
            </PlayerControlTooltip>
          </div>
        )}
        <div className="pointer-events-auto absolute right-3 top-3 z-40 flex items-center gap-2">
          {showTiltReset && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); resetTiltRotation(); }}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/50 text-white/80 shadow-sm backdrop-blur-sm active:scale-95 transition-transform"
              aria-label="Reset tilt"
            >
              <X className="w-5 h-5" />
            </button>
          )}
          {!isHidden(hideControls, 'settings') && (
            <PlayerControlTooltip
              label={
                authPlaybackFeatures
                  ? autoPlay
                    ? 'Autoplay on: plays next when this video ends'
                    : 'Autoplay off'
                  : 'Sign in to use autoplay'
              }
              side="bottom"
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!authPlaybackFeatures) return;
                  setAutoPlay(!autoPlay);
                }}
                disabled={!authPlaybackFeatures}
                className={cn(
                  'flex h-9 items-center gap-2 rounded-full bg-black/50 px-2.5 py-1 backdrop-blur-sm',
                  !authPlaybackFeatures && 'opacity-50'
                )}
                aria-label={autoPlay ? 'Autoplay on' : 'Autoplay off'}
                aria-pressed={autoPlay}
              >
                <span
                  className={cn(
                    'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors duration-200',
                    autoPlay ? 'bg-white/30' : 'bg-white/15'
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-all duration-200',
                      autoPlay ? 'right-0.5' : 'left-0.5'
                    )}
                  >
                    <Play className="h-2.5 w-2.5 fill-neutral-900 text-neutral-900" />
                  </span>
                </span>
              </button>
            </PlayerControlTooltip>
          )}
          {!isHidden(hideControls, 'subtitles') && <SubtitleButton variant="mobileOverlay" />}
          {!isHidden(hideControls, 'cast') && <CastButton mobileOverlay />}
          {!isHidden(hideControls, 'miniPlayer') && authPlaybackFeatures && (
            <MiniPlayerButton mobileOverlay />
          )}
          {!isHidden(hideControls, 'pip') && <PipButton mobileOverlay />}
          {!isHidden(hideControls, 'settings') && authPlaybackFeatures && <SettingsMenu overlayTrigger />}
          {!authPlaybackFeatures && <GuestPlaybackBenefitsDialog variant="mobileOverlay" />}
        </div>

        <div className="pointer-events-auto absolute left-1/2 top-1/2 z-40 flex -translate-x-1/2 -translate-y-1/2 items-center gap-4">
          {!isHidden(hideControls, 'seek') && (
            <PlayerControlTooltip label={`Rewind ${MOBILE_SKIP_SEC} seconds`}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  skipBack(e);
                }}
                className={circleBtn}
                aria-label={`Back ${MOBILE_SKIP_SEC} seconds`}
              >
                <SkipBack className="h-5 w-5 fill-white" />
              </button>
            </PlayerControlTooltip>
          )}
          {!isHidden(hideControls, 'playPause') && (
            <PlayerControlTooltip label={state.isPlaying ? 'Pause' : 'Play'}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlay();
                  onPlayPauseClick?.();
                }}
                className="flex h-[4.5rem] w-[4.5rem] shrink-0 items-center justify-center rounded-full bg-black/50 text-white shadow-md active:scale-95 transition-transform"
                aria-label={state.isPlaying ? 'Pause' : 'Play'}
              >
                {state.isPlaying ? (
                  <Pause className="h-9 w-9 fill-white" />
                ) : (
                  <Play className="ml-1 h-9 w-9 fill-white" />
                )}
              </button>
            </PlayerControlTooltip>
          )}
          {!isHidden(hideControls, 'next') && onNext && (
            <NextVideoTooltipButton
              onClick={handleNextTap}
              className={circleBtn}
              nextVideo={nextVideo}
              nextVideoBadge={nextVideoBadge}
              nextVideoCardCurrentUserId={nextVideoCardCurrentUserId}
              nextVideoCardUserActions={nextVideoCardUserActions}
              ariaLabel="Next video"
            >
              <SkipForward className="h-5 w-5 fill-white" />
            </NextVideoTooltipButton>
          )}
          {!isHidden(hideControls, 'next') && !onNext && !isHidden(hideControls, 'seek') && (
            <PlayerControlTooltip label={`Forward ${MOBILE_SKIP_SEC} seconds`}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  skipForward(e);
                }}
                className={circleBtn}
                aria-label={`Forward ${MOBILE_SKIP_SEC} seconds`}
              >
                <SkipForward className="h-5 w-5 fill-white" />
              </button>
            </PlayerControlTooltip>
          )}
        </div>

        <div
          className="pointer-events-auto absolute bottom-0 left-0 right-0 z-40 flex flex-col gap-2 px-3 pb-3 pt-2"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {!isHidden(hideControls, 'volume') && (
                <div
                  className={cn(
                    'flex h-11 shrink-0 items-center justify-center rounded-full bg-black/50 shadow-sm backdrop-blur-sm',
                    isMobile ? 'px-1.5' : 'min-w-0 pl-1 pr-1.5'
                  )}
                  onClick={(e) => e.stopPropagation()}
                >
                  <VolumeControl showSlider={!isMobile} barPill />
                </div>
              )}
              {!isHidden(hideControls, 'time') && (
                <PlayerControlTooltip label="Current time and total length" side="top">
                  <div className="flex h-11 min-w-0 max-w-full shrink cursor-default items-center justify-center rounded-full bg-black/50 px-2.5 text-[11px] font-medium tabular-nums leading-none text-white shadow-sm backdrop-blur-sm sm:px-3 sm:text-xs">
                    {formatTime(state.currentTime)}
                    <span className="mx-0.5 text-white/50 sm:mx-1">/</span>
                    {formatTime(state.duration)}
                  </div>
                </PlayerControlTooltip>
              )}
            </div>
            {!isHidden(hideControls, 'fullscreen') && <FullscreenButton variant="mobileOverlay" />}
          </div>
          {!isHidden(hideControls, 'seek') && <SeekBar mobileStyle />}
        </div>
      </div>
    );
  }

  const autoplayToggle = !isHidden(hideControls, 'settings') && (
    <PlayerControlTooltip
      label={
        authPlaybackFeatures
          ? autoPlay
            ? 'Autoplay on: plays next when this video ends'
            : 'Autoplay off'
          : 'Sign in to use autoplay'
      }
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!authPlaybackFeatures) return;
          setAutoPlay(!autoPlay);
        }}
        disabled={!authPlaybackFeatures}
        className={cn(
          'flex shrink-0 items-center rounded-full px-2 py-1 transition-opacity',
          !authPlaybackFeatures && 'opacity-50'
        )}
        aria-label={autoPlay ? 'Autoplay on' : 'Autoplay off'}
        aria-pressed={autoPlay}
      >
        <span
          className={cn(
            'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200',
            autoPlay ? 'bg-white/30' : 'bg-white/15'
          )}
        >
          <span
            className={cn(
              'absolute top-px flex h-4 w-4 items-center justify-center rounded-full bg-white shadow transition-all duration-200',
              autoPlay ? 'right-px' : 'left-px'
            )}
          >
            <Play className="h-2 w-2 fill-neutral-900 text-neutral-900" />
          </span>
        </span>
      </button>
    </PlayerControlTooltip>
  );

  return (
    <div
      ref={containerRef}
      className={`absolute left-0 right-0 z-30 flex flex-col ${tiltMode ? 'pointer-events-auto' : ''}`}
      style={{ bottom: liftBottomPx }}
    >
      {!isHidden(hideControls, 'seek') && (
        <div className="px-3 pb-2 pt-1">
          <SeekBar />
        </div>
      )}

      <div className="flex min-w-0 items-center justify-between gap-3 px-3 pb-2 pt-0">
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          {onBack && !isHidden(hideControls, 'back') && (
            <PlayerControlTooltip label="Back">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onBack();
                }}
                className={desktopIconCircle}
                aria-label="Back"
              >
                <ChevronLeft className="h-5 w-5 text-white" />
              </button>
            </PlayerControlTooltip>
          )}
          {!isHidden(hideControls, 'playPause') && (
            <PlayerControlTooltip label={state.isPlaying ? 'Pause' : 'Play'}>
              <button
                type="button"
                onClick={() => {
                  togglePlay();
                  onPlayPauseClick?.();
                }}
                className={desktopIconCircle}
                aria-label={state.isPlaying ? 'Pause' : 'Play'}
              >
                {state.isPlaying ? (
                  <Pause className="h-5 w-5 fill-white" />
                ) : (
                  <Play className="ml-0.5 h-5 w-5 fill-white" />
                )}
              </button>
            </PlayerControlTooltip>
          )}

          {!isHidden(hideControls, 'next') && onNext && (
            <NextVideoTooltipButton
              onClick={() => onNext()}
              className={desktopIconCircle}
              nextVideo={nextVideo}
              nextVideoBadge={nextVideoBadge}
              nextVideoCardCurrentUserId={nextVideoCardCurrentUserId}
              nextVideoCardUserActions={nextVideoCardUserActions}
              ariaLabel="Next"
            >
              <SkipForward className="h-5 w-5 fill-white" />
            </NextVideoTooltipButton>
          )}

          {!isHidden(hideControls, 'volume') && (
            <div className="flex h-10 min-h-10 items-center rounded-full bg-black/50 py-0 pl-1 pr-1.5 shadow-sm backdrop-blur-sm">
              <VolumeControl showSlider={showVolumeSlider && !isMobile} barPill />
            </div>
          )}

          {!isHidden(hideControls, 'time') && showTime && (
            <PlayerControlTooltip label="Current time and total length">
              <div className="flex h-10 min-h-10 min-w-0 shrink cursor-default items-center justify-center rounded-full bg-black/50 px-2.5 text-[11px] font-medium tabular-nums leading-none text-white shadow-sm backdrop-blur-sm sm:px-3 sm:text-xs">
                {formatTime(state.currentTime)}
                <span className="mx-0.5 text-white/45 sm:mx-1">/</span>
                {formatTime(state.duration)}
              </div>
            </PlayerControlTooltip>
          )}
        </div>

        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <div className={desktopRightPill}>
            {showTiltReset && (
              <PlayerControlTooltip label="Reset tilt">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); resetTiltRotation(); }}
                  className="rounded-lg p-2 transition-colors hover:bg-white/10 text-white/80 hover:text-white"
                  aria-label="Reset tilt"
                >
                  <X className="w-4 h-4" />
                </button>
              </PlayerControlTooltip>
            )}
            {autoplayToggle}
            {!isHidden(hideControls, 'subtitles') && <SubtitleButton variant="desktopPill" />}
            {!authPlaybackFeatures && <GuestPlaybackBenefitsDialog variant="controlPill" />}
            {showRightInline &&
              authPlaybackFeatures &&
              !isHidden(hideControls, 'settings') && <SettingsMenu pillBarTrigger />}
            {showRightInline && !isHidden(hideControls, 'cast') && <CastButton controlPill />}
            {showRightInline && authPlaybackFeatures && !isHidden(hideControls, 'miniPlayer') && (
              <MiniPlayerButton controlPill />
            )}
            {showRightInline && !isHidden(hideControls, 'pip') && <PipButton controlPill />}
            {!isHidden(hideControls, 'fullscreen') && <FullscreenButton variant="controlPill" />}
            {showRightInline &&
              authPlaybackFeatures &&
              !isHidden(hideControls, 'theater') &&
              onTheaterModeChange && (
                <TheaterButton theaterMode={theaterMode} onTheaterModeChange={onTheaterModeChange} controlPill />
              )}
          </div>

          {(() => {
            if (showRightInline) return null;
            const overflowSettings = !isHidden(hideControls, 'settings') && authPlaybackFeatures;
            const overflowTheater = !isHidden(hideControls, 'theater') && onTheaterModeChange && authPlaybackFeatures;
            const overflowCast = !isHidden(hideControls, 'cast');
            const overflowMini = !isHidden(hideControls, 'miniPlayer') && authPlaybackFeatures;
            const overflowPip = !isHidden(hideControls, 'pip');
            const otherOverflow = overflowTheater || overflowCast || overflowMini || overflowPip;
            // Settings-only overflow → render gear directly instead of a single-item kebab.
            if (overflowSettings && !otherOverflow) {
              return <SettingsMenu pillBarTrigger />;
            }
            if (!overflowSettings && !otherOverflow) return null;
            return (
              <>
                <PlayerControlTooltip label="More controls">
                  <button
                    ref={moreButtonRef}
                    type="button"
                    onClick={() => setOverflowOpen((o) => !o)}
                    className={`${desktopIconCircle}`}
                    aria-label="More controls"
                  >
                    <MoreVertical className="h-5 w-5" />
                  </button>
                </PlayerControlTooltip>
                {overflowOpen &&
                  typeof document !== 'undefined' &&
                  createPortal(
                    <div
                      ref={overflowRef}
                      className="fixed z-[100000100] flex max-h-[55vh] min-w-[200px] max-w-[280px] flex-col overflow-y-auto rounded-xl border border-white/10 bg-zinc-900/95 py-1 shadow-xl backdrop-blur-md"
                      style={{
                        position: 'fixed',
                        left: dropdownStyle.left,
                        ...(dropdownStyle.top != null ? { top: dropdownStyle.top } : { bottom: dropdownStyle.bottom }),
                        maxHeight: dropdownStyle.maxHeight,
                      }}
                    >
                      {authPlaybackFeatures && !isHidden(hideControls, 'settings') && <SettingsMenu nested />}
                      {authPlaybackFeatures && !isHidden(hideControls, 'theater') && onTheaterModeChange && (
                        <div className="px-2 py-1" onClick={() => setOverflowOpen(false)}>
                          <TheaterButton theaterMode={theaterMode} onTheaterModeChange={onTheaterModeChange} />
                        </div>
                      )}
                      {!isHidden(hideControls, 'cast') && (
                        <div className="px-2 py-1" onClick={() => setOverflowOpen(false)}>
                          <CastButton />
                        </div>
                      )}
                      {authPlaybackFeatures && !isHidden(hideControls, 'miniPlayer') && (
                        <div className="px-2 py-1" onClick={() => setOverflowOpen(false)}>
                          <MiniPlayerButton />
                        </div>
                      )}
                      {!isHidden(hideControls, 'pip') && (
                        <div className="px-2 py-1" onClick={() => setOverflowOpen(false)}>
                          <PipButton />
                        </div>
                      )}
                    </div>,
                    document.body
                  )}
              </>
            );
          })()}
        </div>
      </div>
      {bottomSlot}
    </div>
  );
}
