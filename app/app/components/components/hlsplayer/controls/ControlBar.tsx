import { useRef, useState, useEffect, useLayoutEffect, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Play, Pause, SkipForward, MoreVertical, SkipBack, ChevronLeft, LoaderCircle, X } from 'lucide-react';
import { usePlayerContext } from '../PlayerContext';
import { useControlBarWidth } from '../hooks/useControlBarWidth';
import { useFullscreenContainer } from '../hooks/useFullscreenContainer';
import {
  mobileControlStyleVars,
  mobileOverlayCircleBtn,
  mobileOverlayIcon,
  mobileOverlayMainIcon,
  mobileVolumePillShell,
  mobileTimePill,
  mobileTimePillStyle,
  mobileTimeSeparatorStyle,
  mobilePillShellStyle,
  mobileAutoplayToggleTrack,
  mobileAutoplayToggleKnob,
  mobileAutoplayToggleIcon,
} from './mobileControlMetrics';
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
import { cn, getThumbnailUrl } from '~/lib/utils';
import { BASE_URL } from '~/lib/URLS';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';
import type { FileType } from '~/lib/types';

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

const compactViews = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/**
 * "Up next" hover preview — a compact card, not a full VideoCard: thumbnail
 * with duration chip, badge in the corner, and a tight title/creator block.
 */
function NextVideoTooltipButton({
  onClick,
  className,
  children,
  nextVideo,
  nextVideoBadge,
  ariaLabel,
}: {
  onClick: (e: React.MouseEvent) => void;
  className: string;
  children: React.ReactNode;
  nextVideo?: FileType;
  nextVideoBadge?: string;
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

  const thumb = getThumbnailUrl(nextVideo, {
    baseUrl: BASE_URL,
    queryString: '?quality=60&is_metadata=true',
  });
  const views = nextVideo.views ?? nextVideo.view_count;
  const creator = nextVideo.owner?.username;
  const meta = [creator, views != null ? `${compactViews.format(views)} views` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <Tooltip delayDuration={220}>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={10} className="w-60 overflow-hidden rounded-xl p-0">
        <div className="relative aspect-video w-full overflow-hidden bg-muted">
          {thumb ? (
            <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Play className="h-7 w-7 text-muted-foreground/60" />
            </div>
          )}
          {nextVideoBadge ? (
            <span className="absolute left-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
              {nextVideoBadge}
            </span>
          ) : null}
          {nextVideo.duration ? (
            <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/80 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
              {formatTime(nextVideo.duration)}
            </span>
          ) : null}
        </div>
        <div className="space-y-0.5 px-2.5 py-2">
          <p className="line-clamp-2 text-xs font-semibold leading-snug">{title}</p>
          {meta ? <p className="truncate text-[11px] text-muted-foreground">{meta}</p> : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

interface ControlBarProps {
  onNext?: () => void;
  /** Compact preview card in the next control tooltip when the target is known. */
  nextVideo?: FileType;
  nextVideoBadge?: string;
  /** Accepted for call-site compat; the compact preview no longer needs them. */
  nextVideoCardCurrentUserId?: string;
  nextVideoCardUserActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
  theaterMode?: boolean;
  onTheaterModeChange?: (active: boolean) => void;
  onPlayPauseClick?: () => void;
  hideControls?: HideControls;
  liftBottomPx?: number;
  isMobileLayout?: boolean;
  /** Compact always-on chrome for the floating mini player dock. */
  miniLayout?: boolean;
  /**
   * Mobile music-bar mini: seek rail only — no back/volume/settings/play/close.
   * Shell handles expand + dismiss.
   */
  miniSeekOnly?: boolean;
  /** Shown as a chevron back control when set, unless `hideControls.back`. */
  onBack?: () => void;
  /** Mini layout only: close the floating player. */
  onClose?: () => void;
  /** Rendered at the very bottom of the control bar flex-col (e.g. audio visualizer). */
  bottomSlot?: React.ReactNode;
}

export default function ControlBar({
  onNext,
  nextVideo,
  nextVideoBadge,
  theaterMode = false,
  onTheaterModeChange,
  onPlayPauseClick,
  hideControls,
  liftBottomPx = 0,
  isMobileLayout = false,
  miniLayout = false,
  miniSeekOnly = false,
  onBack,
  onClose,
  bottomSlot,
}: ControlBarProps) {
  const {
    state,
    togglePlay,
    seek,
    videoRef,
    autoPlay,
    setAutoPlay,
    authPlaybackFeatures,
    isReel,
    reelEmbedAutoHide,
    setReelChromeBottomReservePx,
  } = usePlayerContext();

  // Reel chrome (play/volume/CC/settings) lives in the top cluster, so reels
  // only ever render the seek strip here — the info overlay never has to lift.
  const reelSeekOnly = reelEmbedAutoHide;
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomStripRef = useRef<HTMLDivElement>(null);
  // In fullscreen, portal the overflow menu into the fullscreen element so it's
  // visible (a portal to document.body hides behind the fullscreen view).
  const fullscreenContainer = useFullscreenContainer();

  /** Report bottom chrome height so ReelInfoOverlay can sit above volume/time/seek. */
  useLayoutEffect(() => {
    if (!reelEmbedAutoHide) {
      setReelChromeBottomReservePx(0);
      return;
    }
    const el = bottomStripRef.current;
    if (!el) {
      setReelChromeBottomReservePx(0);
      return;
    }
    const measure = () => {
      setReelChromeBottomReservePx(Math.ceil(el.getBoundingClientRect().height) + 12);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      setReelChromeBottomReservePx(0);
    };
  }, [
    reelEmbedAutoHide,
    isMobileLayout,
    hideControls,
    setReelChromeBottomReservePx,
  ]);
  const { showTime, showRightInline, showVolumeSlider, mobileMetrics } = useControlBarWidth(containerRef);
  const mobileVars = mobileControlStyleVars(mobileMetrics);
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

  const circleBtn = cn(
    mobileOverlayCircleBtn,
    'bg-black/40 text-white shadow-sm active:scale-95 transition-transform',
  );

  const desktopIconCircle =
    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/40 text-white shadow-sm transition-colors hover:bg-black/60';

  const desktopRightPill =
    'flex max-w-[min(100%,28rem)] items-center gap-0.5 overflow-x-auto rounded-full bg-black/40 px-1.5 py-1 shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

  const autoplayKnobOffset = autoPlay
    ? { right: 'calc((var(--hls-ctrl-toggle-h, 1.5rem) - var(--hls-ctrl-toggle-knob, 1.25rem)) / 2)' }
    : { left: 'calc((var(--hls-ctrl-toggle-h, 1.5rem) - var(--hls-ctrl-toggle-knob, 1.25rem)) / 2)' };

  if (miniLayout && miniSeekOnly) {
    // Full-width thin rail along the top. Shell chrome uses pt + pointer-events so
    // queue/close stay clickable while scrub + hover preview sit above the bar.
    return (
      <div
        ref={containerRef}
        className="pointer-events-none absolute inset-0 z-30 overflow-visible"
      >
        {!isHidden(hideControls, 'seek') && (
          <div
            data-mini-no-drag
            className="pointer-events-auto absolute inset-x-0 top-0 z-[60] overflow-visible"
            style={{
              // Tall hit target for hover scrub / thumbnail preview. Visible
              // track stays flush to the top; shell chrome pads below this.
              height: '1.75rem',
              ['--hls-ctrl-seek-hit' as string]: '1.75rem',
              ['--hls-ctrl-seek-track' as string]: '2px',
            }}
          >
            <SeekBar mobileStyle flushTop />
          </div>
        )}
      </div>
    );
  }

  if (miniLayout) {
    const isPlayPauseLoading = !state.isLoaded || state.isBuffering;
    // Seek stays mounted; only top/center chrome follows auxiliary visibility
    // (same seek-always pattern as reel embeds — see useControlsVisibility).
    const chromeOn = state.reelAuxiliaryChromeVisible;
    return (
      <div
        ref={containerRef}
        className="pointer-events-none absolute inset-0 z-30"
        style={{ bottom: liftBottomPx }}
      >
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 z-40 flex items-start justify-between gap-1 p-1.5 transition-opacity',
            chromeOn ? 'opacity-100 duration-100' : 'opacity-0 duration-200',
          )}
          inert={!chromeOn || undefined}
        >
          <div
            data-mini-no-drag
            className={cn(
              'flex items-center gap-0.5',
              chromeOn ? 'pointer-events-auto' : 'pointer-events-none',
            )}
          >
            {onBack && !isHidden(hideControls, 'back') && (
              <PlayerControlTooltip label="Back to video" side="bottom">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onBack();
                  }}
                  className={cn(mobileOverlayCircleBtn, 'h-8 w-8 transition-colors hover:bg-black/60')}
                  aria-label="Back to video"
                >
                  <ChevronLeft className="h-5 w-5 text-white" />
                </button>
              </PlayerControlTooltip>
            )}
            {!isHidden(hideControls, 'volume') && (
              <div className="flex items-center text-white [&_button]:text-white [&_svg]:text-white">
                <VolumeControl showSlider expandWithTap barPill />
              </div>
            )}
          </div>
          <div
            data-mini-no-drag
            className={cn(
              'flex items-center gap-0.5',
              chromeOn ? 'pointer-events-auto' : 'pointer-events-none',
            )}
          >
            {!isHidden(hideControls, 'settings') && authPlaybackFeatures && (
              <SettingsMenu overlayTrigger />
            )}
            {onClose && (
              <PlayerControlTooltip label="Close" side="bottom">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose();
                  }}
                  className={cn(mobileOverlayCircleBtn, 'h-8 w-8 transition-colors hover:bg-black/60')}
                  aria-label="Close mini player"
                >
                  <X className="h-4 w-4 text-white" />
                </button>
              </PlayerControlTooltip>
            )}
          </div>
        </div>

        <div
          className={cn(
            'pointer-events-none absolute inset-0 z-40 flex items-center justify-center transition-opacity',
            chromeOn ? 'opacity-100 duration-100' : 'opacity-0 duration-200',
          )}
          inert={!chromeOn || undefined}
        >
          {!isHidden(hideControls, 'playPause') && (
            isPlayPauseLoading ? (
              <div
                data-mini-no-drag
                className={cn(
                  'flex h-12 w-12 items-center justify-center text-white',
                  chromeOn ? 'pointer-events-auto' : 'pointer-events-none',
                )}
                aria-label="Loading"
                role="status"
              >
                <LoaderCircle className="h-10 w-10 animate-spin opacity-90" />
              </div>
            ) : (
              <button
                type="button"
                data-mini-no-drag
                className={cn(
                  'flex h-12 w-12 items-center justify-center text-white transition-transform active:scale-95',
                  chromeOn ? 'pointer-events-auto' : 'pointer-events-none',
                )}
                aria-label={state.isPlaying ? 'Pause' : 'Play'}
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlay();
                  onPlayPauseClick?.();
                }}
              >
                {state.isPlaying ? (
                  <Pause className="h-10 w-10 fill-white drop-shadow-md" />
                ) : (
                  <Play className="h-10 w-10 fill-white drop-shadow-md ml-0.5" />
                )}
              </button>
            )
          )}
        </div>

        {!isHidden(hideControls, 'seek') && (
          <div
            data-mini-no-drag
            className="pointer-events-auto absolute inset-x-0 bottom-0 z-40"
          >
            <SeekBar mobileStyle flushBottom />
          </div>
        )}
      </div>
    );
  }

  if (reelSeekOnly) {
    if (isMobileLayout) {
      return (
        <div
          ref={containerRef}
          className="pointer-events-none absolute inset-0 z-30 flex flex-col"
          style={{ ...mobileVars, bottom: liftBottomPx }}
        >
          <div
            ref={bottomStripRef}
            className="pointer-events-auto absolute bottom-0 left-0 right-0 z-40 flex flex-col px-[var(--hls-ctrl-pad,0.75rem)] pb-[var(--hls-ctrl-pad,0.75rem)] pt-2"
            // Safe-area inset only in real fullscreen (viewport-relative); embedded
            // players used to get phantom bottom padding that lifted the controls up.
            style={{
              paddingBottom: state.isFullscreen
                ? 'max(var(--hls-ctrl-pad, 0.75rem), env(safe-area-inset-bottom))'
                : 'var(--hls-ctrl-pad, 0.75rem)',
            }}
          >
            {!isHidden(hideControls, 'seek') && <SeekBar mobileStyle scaledStyle />}
          </div>
        </div>
      );
    }
    return (
      <div
        ref={(node) => {
          containerRef.current = node;
          bottomStripRef.current = node;
        }}
        className="pointer-events-auto absolute left-0 right-0 z-30 flex flex-col"
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
        style={{ ...mobileVars, bottom: liftBottomPx }}
      >
        {/* Top chrome: back + autoplay on the left, utility icons on the right. */}
        <div
          className="pointer-events-none absolute left-0 right-0 z-40 flex items-start justify-between"
          style={{
            paddingLeft: 'var(--hls-ctrl-inset, 0.75rem)',
            paddingRight: 'var(--hls-ctrl-inset, 0.75rem)',
            top: 'var(--hls-ctrl-inset, 0.75rem)',
          }}
        >
          <div
            className="pointer-events-auto flex flex-wrap items-center"
            style={{ gap: 'var(--hls-ctrl-top-gap, 0.5rem)' }}
          >
            {onBack && !isHidden(hideControls, 'back') && (
              <PlayerControlTooltip label="Back" side="bottom">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onBack();
                  }}
                  className={cn(mobileOverlayCircleBtn, 'transition-colors hover:bg-black/60')}
                  aria-label="Back"
                >
                  <ChevronLeft className={cn(mobileOverlayIcon, 'text-white')} />
                </button>
              </PlayerControlTooltip>
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
                    'flex shrink-0 items-center gap-1.5 rounded-full bg-black/40 py-1',
                    !authPlaybackFeatures && 'opacity-50',
                  )}
                  style={{
                    height: 'var(--hls-ctrl-small-btn, 2.25rem)',
                    paddingLeft: 'calc(var(--hls-ctrl-top-gap, 0.5rem) + 2px)',
                    paddingRight: 'calc(var(--hls-ctrl-top-gap, 0.5rem) + 2px)',
                  }}
                  aria-label={autoPlay ? 'Autoplay on' : 'Autoplay off'}
                  aria-pressed={autoPlay}
                >
                  <span
                    className={cn(
                      mobileAutoplayToggleTrack,
                      autoPlay ? 'bg-white/30' : 'bg-white/15',
                    )}
                  >
                    <span className={mobileAutoplayToggleKnob} style={autoplayKnobOffset}>
                      <Play className={mobileAutoplayToggleIcon} />
                    </span>
                  </span>
                </button>
              </PlayerControlTooltip>
            )}
          </div>
          <div
            className="pointer-events-auto flex max-w-[70%] flex-wrap items-center justify-end"
            style={{ gap: 'var(--hls-ctrl-top-gap, 0.5rem)' }}
          >
            {!isHidden(hideControls, 'subtitles') && <SubtitleButton variant="mobileOverlay" />}
            {!isHidden(hideControls, 'cast') && <CastButton mobileOverlay />}
            {!isHidden(hideControls, 'miniPlayer') && authPlaybackFeatures && (
              <MiniPlayerButton mobileOverlay />
            )}
            {!isHidden(hideControls, 'pip') && <PipButton mobileOverlay />}
            {!isHidden(hideControls, 'settings') && authPlaybackFeatures && <SettingsMenu overlayTrigger />}
            {!authPlaybackFeatures && <GuestPlaybackBenefitsDialog variant="mobileOverlay" />}
          </div>
        </div>

        <div
          className="pointer-events-auto absolute left-1/2 top-1/2 z-40 flex -translate-x-1/2 -translate-y-1/2 items-center"
          style={{ gap: 'var(--hls-ctrl-gap, 1rem)' }}
        >
          {!isReel && !isHidden(hideControls, 'seek') && (
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
                <SkipBack className={cn(mobileOverlayIcon, 'fill-white')} />
              </button>
            </PlayerControlTooltip>
          )}
          {!isHidden(hideControls, 'playPause') && (() => {
            // Mobile: while the player is loading / buffering, replace the
            // play-pause circle with a spinner in the same spot. Avoids the
            // global spinner sitting behind the button and looking broken.
            const isPlayPauseLoading = !state.isLoaded || state.isBuffering;
            if (isPlayPauseLoading) {
              return (
                <div
                  className="flex shrink-0 items-center justify-center rounded-full bg-black/50 text-white shadow-md"
                  style={{
                    width: 'var(--hls-ctrl-main-btn, 4.5rem)',
                    height: 'var(--hls-ctrl-main-btn, 4.5rem)',
                  }}
                  aria-label="Loading"
                  role="status"
                >
                  <LoaderCircle className={cn(mobileOverlayMainIcon, 'animate-spin opacity-90')} />
                </div>
              );
            }
            return (
              <PlayerControlTooltip label={state.isPlaying ? 'Pause' : 'Play'}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePlay();
                    onPlayPauseClick?.();
                  }}
                  className="flex shrink-0 items-center justify-center rounded-full bg-black/50 text-white shadow-md active:scale-95 transition-transform"
                  style={{
                    width: 'var(--hls-ctrl-main-btn, 4.5rem)',
                    height: 'var(--hls-ctrl-main-btn, 4.5rem)',
                  }}
                  aria-label={state.isPlaying ? 'Pause' : 'Play'}
                >
                  {state.isPlaying ? (
                    <Pause className={cn(mobileOverlayMainIcon, 'fill-white')} />
                  ) : (
                    <Play className={cn(mobileOverlayMainIcon, 'ml-0.5 fill-white')} />
                  )}
                </button>
              </PlayerControlTooltip>
            );
          })()}
          {!isHidden(hideControls, 'next') && onNext && (
            <NextVideoTooltipButton
              onClick={handleNextTap}
              className={circleBtn}
              nextVideo={nextVideo}
              nextVideoBadge={nextVideoBadge}
              ariaLabel="Next video"
            >
              <SkipForward className={cn(mobileOverlayIcon, 'fill-white')} />
            </NextVideoTooltipButton>
          )}
          {!isReel && !isHidden(hideControls, 'next') && !onNext && !isHidden(hideControls, 'seek') && (
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
                <SkipForward className={cn(mobileOverlayIcon, 'fill-white')} />
              </button>
            </PlayerControlTooltip>
          )}
        </div>

        <div
          ref={bottomStripRef}
          className="pointer-events-auto absolute bottom-0 left-0 right-0 z-40 flex flex-col gap-[var(--hls-ctrl-top-gap,0.5rem)] px-[var(--hls-ctrl-pad,0.75rem)] pb-[var(--hls-ctrl-pad,0.75rem)] pt-2"
          // Only honor the home-indicator inset in real fullscreen. env(safe-area-inset-bottom)
          // is measured from the VIEWPORT, so on an embedded player it added phantom bottom
          // padding that lifted the controls off the player's bottom edge.
          style={{
            paddingBottom: state.isFullscreen
              ? 'max(var(--hls-ctrl-pad, 0.75rem), env(safe-area-inset-bottom))'
              : 'var(--hls-ctrl-pad, 0.75rem)',
          }}
        >
          <div
            className="flex items-center justify-between"
            style={{ gap: 'var(--hls-ctrl-top-gap, 0.5rem)' }}
          >
            <div
              className="flex min-w-0 flex-1 items-center"
              style={{ gap: 'var(--hls-ctrl-top-gap, 0.5rem)' }}
            >
              {!isHidden(hideControls, 'volume') && (
                <div
                  className={cn(mobileVolumePillShell, isMobile ? 'px-[var(--hls-ctrl-pill-px,0.5rem)]' : 'min-w-0 pl-[var(--hls-ctrl-pill-px,0.5rem)] pr-[calc(var(--hls-ctrl-pill-px,0.5rem)*1.2)]')}
                  style={mobilePillShellStyle()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <VolumeControl showSlider={!isMobile} barPill mobileScaledIcons />
                </div>
              )}
              {!isHidden(hideControls, 'time') && (
                <PlayerControlTooltip label="Current time and total length" side="top">
                  <div className={mobileTimePill} style={mobileTimePillStyle()}>
                    {formatTime(state.currentTime)}
                    <span className="text-white/50" style={mobileTimeSeparatorStyle()}>/</span>
                    {formatTime(state.duration)}
                  </div>
                </PlayerControlTooltip>
              )}
            </div>
            {!isHidden(hideControls, 'fullscreen') && <FullscreenButton variant="mobileOverlay" />}
          </div>
          {!isHidden(hideControls, 'seek') && <SeekBar mobileStyle scaledStyle />}
        </div>
      </div>
    );
  }

  const desktopAutoplayToggle = !isHidden(hideControls, 'settings') && (
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
          !authPlaybackFeatures && 'opacity-50',
        )}
        aria-label={autoPlay ? 'Autoplay on' : 'Autoplay off'}
        aria-pressed={autoPlay}
      >
        <span
          className={cn(
            'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200',
            autoPlay ? 'bg-white/30' : 'bg-white/15',
          )}
        >
          <span
            className={cn(
              'absolute top-px flex h-4 w-4 items-center justify-center rounded-full bg-white shadow transition-all duration-200',
              autoPlay ? 'right-px' : 'left-px',
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
      ref={(node) => {
        containerRef.current = node;
        bottomStripRef.current = node;
      }}
      className="pointer-events-auto absolute left-0 right-0 z-30 flex flex-col"
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
              ariaLabel="Next"
            >
              <SkipForward className="h-5 w-5 fill-white" />
            </NextVideoTooltipButton>
          )}

          {!isHidden(hideControls, 'volume') && (
            <div className="flex h-10 min-h-10 items-center rounded-full bg-black/40 py-0 pl-1 pr-1.5 shadow-sm">
              <VolumeControl showSlider={showVolumeSlider && !isMobile} barPill />
            </div>
          )}

          {!isHidden(hideControls, 'time') && showTime && (
            <PlayerControlTooltip label="Current time and total length">
              <div className="flex h-10 min-h-10 min-w-0 shrink cursor-default items-center justify-center rounded-full bg-black/40 px-2.5 text-[11px] font-medium tabular-nums leading-none text-white shadow-sm sm:px-3 sm:text-xs">
                {formatTime(state.currentTime)}
                <span className="mx-0.5 text-white/45 sm:mx-1">/</span>
                {formatTime(state.duration)}
              </div>
            </PlayerControlTooltip>
          )}
        </div>

        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <div className={desktopRightPill}>
            {/* On a narrow player (e.g. portrait video) autoplay + subtitles
                collapse into the "..." menu too, so the bar never overflows. */}
            {showRightInline && desktopAutoplayToggle}
            {showRightInline && !isHidden(hideControls, 'subtitles') && <SubtitleButton variant="desktopPill" />}
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
            const overflowSubtitles = !isHidden(hideControls, 'subtitles');
            const overflowSettings = !isHidden(hideControls, 'settings') && authPlaybackFeatures;
            const overflowTheater = !isHidden(hideControls, 'theater') && onTheaterModeChange && authPlaybackFeatures;
            const overflowCast = !isHidden(hideControls, 'cast');
            const overflowMini = !isHidden(hideControls, 'miniPlayer') && authPlaybackFeatures;
            const overflowPip = !isHidden(hideControls, 'pip');
            // autoplay + subtitles now collapse here too on narrow players.
            const hasOverflow =
              overflowSubtitles || Boolean(desktopAutoplayToggle) || overflowSettings ||
              overflowTheater || overflowCast || overflowMini || overflowPip;
            if (!hasOverflow) return null;
            return (
              <>
                <PlayerControlTooltip label="More controls">
                  <button
                    ref={moreButtonRef}
                    type="button"
                    onClick={() => setOverflowOpen((o) => !o)}
                    className={desktopIconCircle}
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
                      className="dark fixed z-[100000100] flex max-h-[55vh] min-w-[200px] max-w-[280px] flex-col overflow-y-auto rounded-xl border border-white/10 bg-black/40 py-1 text-white shadow-xl backdrop-blur-xl"
                      style={{
                        position: 'fixed',
                        left: dropdownStyle.left,
                        ...(dropdownStyle.top != null ? { top: dropdownStyle.top } : { bottom: dropdownStyle.bottom }),
                        maxHeight: dropdownStyle.maxHeight,
                      }}
                    >
                      {desktopAutoplayToggle && <div className="px-2 py-1">{desktopAutoplayToggle}</div>}
                      {!isHidden(hideControls, 'subtitles') && (
                        <div className="px-2 py-1" onClick={() => setOverflowOpen(false)}>
                          <SubtitleButton variant="desktopPill" />
                        </div>
                      )}
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
                    fullscreenContainer ?? document.body
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
