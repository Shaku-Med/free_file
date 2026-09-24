import {
  useRef,
  useState,
  useEffect,
  useLayoutEffect,
  type ReactElement,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Play, Pause, SkipForward, SkipBack, ChevronLeft, LoaderCircle, X } from '~/components/icons';
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
import { FoldableControlRow, type FoldGroup, type FoldItem } from './FoldableControlRow';
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
  return (
    <Tooltip delayDuration={220}>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={10}
        className="w-64 overflow-hidden rounded-xl border-white/10 bg-black/85 p-0 backdrop-blur-md"
      >
        {/* Label + shortcut sit above the frame, same as YouTube's next preview. */}
        <div className="flex items-center gap-2 px-3 pb-2 pt-2.5">
          <span className="text-[13px] font-semibold uppercase tracking-wide text-white">Next</span>
          <span className="rounded border border-white/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/90">
            Shift+N
          </span>
        </div>
        <div className="relative aspect-video w-full overflow-hidden bg-white/5">
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
        {title ? (
          <p className="line-clamp-2 px-3 py-2 text-xs font-medium leading-snug text-white/90">
            {title}
          </p>
        ) : null}
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
  /**
   * A double tap seek indicator is on screen. The mobile skip and play circles
   * sit in the middle at z-40 and the indicator draws at 15% from the edge at
   * z-20, so on a phone they land on top of each other; the circles step aside
   * while it shows.
   */
  seekFeedbackActive?: boolean;
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
  seekFeedbackActive = false,
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
  const { showTime, showVolumeSlider, mobileMetrics } = useControlBarWidth(containerRef);
  const mobileVars = mobileControlStyleVars(mobileMetrics);
  // Clicking the time swaps elapsed for time remaining, same as YouTube.
  const [showRemaining, setShowRemaining] = useState(false);
  const canCountDown = Number.isFinite(state.duration) && state.duration > 0;
  const elapsedLabel =
    showRemaining && canCountDown
      ? `-${formatTime(Math.max(0, state.duration - state.currentTime))}`
      : formatTime(state.currentTime);
  const toggleRemaining = (e: ReactMouseEvent) => {
    e.stopPropagation();
    if (canCountDown) setShowRemaining(v => !v);
  };
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
    'flex items-center gap-0.5 rounded-full bg-black/40 px-1.5 py-1 shadow-sm';

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
          className={cn(
            'absolute left-1/2 top-1/2 z-40 flex -translate-x-1/2 -translate-y-1/2 items-center transition-opacity',
            // Out of the way, and out of the way of taps: a third tap during
            // the indicator should keep seeking, not hit the play button.
            seekFeedbackActive
              ? 'pointer-events-none opacity-0 duration-100'
              : 'pointer-events-auto opacity-100 duration-200',
          )}
          style={{ gap: 'var(--hls-ctrl-gap, 1rem)' }}
          inert={seekFeedbackActive || undefined}
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
                <PlayerControlTooltip
                  label={showRemaining ? 'Time remaining and total length' : 'Current time and total length'}
                  side="top"
                >
                  <button
                    type="button"
                    onClick={toggleRemaining}
                    aria-label={showRemaining ? 'Show elapsed time' : 'Show time remaining'}
                    className={mobileTimePill}
                    style={mobileTimePillStyle()}
                  >
                    {elapsedLabel}
                    <span className="text-white/50" style={mobileTimeSeparatorStyle()}>/</span>
                    {formatTime(state.duration)}
                  </button>
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

  /**
   * The desktop row, described as groups of items rather than fixed markup, so
   * the row itself can decide what the player has room for. Lower priority folds
   * away first; play and fullscreen never do.
   */
  const desktopGroups: FoldGroup[] = (() => {
    const left: FoldItem[] = [];
    if (onBack && !isHidden(hideControls, 'back')) {
      left.push({
        key: 'back',
        priority: 95,
        node: (
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
        ),
      });
    }
    if (!isHidden(hideControls, 'playPause')) {
      left.push({
        key: 'playPause',
        priority: 100,
        essential: true,
        node: (
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
        ),
      });
    }
    if (!isHidden(hideControls, 'next') && onNext) {
      left.push({
        key: 'next',
        priority: 60,
        node: (
          <NextVideoTooltipButton
            onClick={() => onNext()}
            className={desktopIconCircle}
            nextVideo={nextVideo}
            nextVideoBadge={nextVideoBadge}
            ariaLabel="Next"
          >
            <SkipForward className="h-5 w-5 fill-white" />
          </NextVideoTooltipButton>
        ),
      });
    }
    if (!isHidden(hideControls, 'volume')) {
      left.push({
        key: 'volume',
        priority: 80,
        // The slider opens to 80px on hover; claim that up front so opening it
        // never steals room from anything else.
        estimate: 140,
        node: (
          <div className="flex h-10 min-h-10 items-center rounded-full bg-black/40 py-0 pl-1 pr-1.5 shadow-sm">
            <VolumeControl showSlider={!isMobile} barPill />
          </div>
        ),
      });
    }
    if (!isHidden(hideControls, 'time')) {
      left.push({
        key: 'time',
        priority: 90,
        estimate: 88,
        node: (
          <PlayerControlTooltip
            label={showRemaining ? 'Time remaining and total length' : 'Current time and total length'}
          >
            <button
              type="button"
              onClick={toggleRemaining}
              aria-label={showRemaining ? 'Show elapsed time' : 'Show time remaining'}
              className="flex h-10 min-h-10 items-center justify-center rounded-full bg-black/40 px-2.5 text-[11px] font-medium tabular-nums leading-none text-white shadow-sm transition hover:bg-black/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-3 sm:text-xs"
            >
              {elapsedLabel}
              <span className="mx-0.5 text-white/45 sm:mx-1">/</span>
              {formatTime(state.duration)}
            </button>
          </PlayerControlTooltip>
        ),
      });
    }

    const right: FoldItem[] = [];
    if (desktopAutoplayToggle) {
      right.push({ key: 'autoplay', priority: 20, estimate: 56, node: desktopAutoplayToggle });
    }
    if (!isHidden(hideControls, 'subtitles')) {
      right.push({ key: 'subtitles', priority: 25, node: <SubtitleButton variant="desktopPill" /> });
    }
    if (!authPlaybackFeatures) {
      right.push({
        key: 'guest',
        priority: 85,
        node: <GuestPlaybackBenefitsDialog variant="controlPill" />,
      });
    }
    if (authPlaybackFeatures && !isHidden(hideControls, 'settings')) {
      right.push({ key: 'settings', priority: 70, estimate: 48, node: <SettingsMenu pillBarTrigger /> });
    }
    if (!isHidden(hideControls, 'cast')) {
      right.push({ key: 'cast', priority: 35, node: <CastButton controlPill /> });
    }
    if (authPlaybackFeatures && !isHidden(hideControls, 'miniPlayer')) {
      right.push({ key: 'mini', priority: 40, node: <MiniPlayerButton controlPill /> });
    }
    if (!isHidden(hideControls, 'pip')) {
      right.push({ key: 'pip', priority: 50, node: <PipButton controlPill /> });
    }
    if (authPlaybackFeatures && !isHidden(hideControls, 'theater') && onTheaterModeChange) {
      right.push({
        key: 'theater',
        priority: 45,
        node: (
          <TheaterButton theaterMode={theaterMode} onTheaterModeChange={onTheaterModeChange} controlPill />
        ),
      });
    }
    if (!isHidden(hideControls, 'fullscreen')) {
      right.push({
        key: 'fullscreen',
        priority: 100,
        essential: true,
        node: <FullscreenButton variant="controlPill" />,
      });
    }

    const out: FoldGroup[] = [];
    if (left.length) {
      out.push({ id: 'left', items: left, expandLabel: 'Show playback controls', itemGapPx: 8 });
    }
    if (right.length) {
      out.push({
        id: 'right',
        items: right,
        expandLabel: 'Show more controls',
        // gap-0.5 between the pill's icons, px-1.5 either side of the pill.
        itemGapPx: 2,
        chromePx: 12,
        wrap: (children) => <div className={desktopRightPill}>{children}</div>,
      });
    }
    return out;
  })();

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

      <FoldableControlRow className="px-3 pb-2 pt-0" groups={desktopGroups} />

      {bottomSlot}
    </div>
  );
}
