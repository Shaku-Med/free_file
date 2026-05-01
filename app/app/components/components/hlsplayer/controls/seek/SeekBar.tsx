import { useRef, useState, useCallback, useEffect } from 'react';
import { ChevronsUp } from 'lucide-react';
import { usePlayerContext } from '../../PlayerContext';
import type { BufferedRange } from '../../PlayerContext';
import ThumbnailPreview from './ThumbnailPreview';
import { formatTime } from './functions/formatTime';
import { cn } from '~/lib/utils';

const WAVEFORM_STRIP_HEIGHT = 40;
const PULL_REVEAL_PX = 96;
/** Visual rail height (matches the slim rail in the desktop ThinSeekTrack). */
const RAIL_HEIGHT_PX = 4;
/** Pointer-target height around the rail so the seek bar is easy to grab. */
const HIT_AREA_HEIGHT_PX = 20;

function BufferSegments({ ranges, duration, className }: {
  ranges: BufferedRange[];
  duration: number;
  className?: string;
}) {
  if (duration <= 0 || ranges.length === 0) return null;
  return (
    <>
      {ranges.map((range, i) => {
        const left = (range.start / duration) * 100;
        const width = ((range.end - range.start) / duration) * 100;
        return (
          <div
            key={i}
            className={`absolute top-0 h-full transition-[width,left] duration-300 ease-out ${className ?? 'bg-white/25 rounded-full'}`}
            style={{ left: `${left}%`, width: `${width}%` }}
          />
        );
      })}
    </>
  );
}

function useVideoProgress(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  handleInsetPx: number
) {
  const progressRef = useRef(0);
  const durationRef = useRef(0);
  const barRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let rafId = 0;
    let running = false;
    const inset = handleInsetPx;

    const update = () => {
      if (!running) return;
      const v = videoRef.current;
      if (v && v.duration > 0) {
        const pct = (v.currentTime / v.duration) * 100;
        progressRef.current = pct;
        durationRef.current = v.duration;
        if (barRef.current) barRef.current.style.width = `${pct}%`;
        if (handleRef.current) handleRef.current.style.left = `calc(${pct}% - ${inset}px)`;
        if (timeRef.current) timeRef.current.textContent = formatTime(v.currentTime);
      }
      rafId = requestAnimationFrame(update);
    };

    const start = () => {
      if (running) return;
      running = true;
      rafId = requestAnimationFrame(update);
    };

    const stop = () => {
      running = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      const v = videoRef.current;
      if (v && v.duration > 0) {
        const pct = (v.currentTime / v.duration) * 100;
        progressRef.current = pct;
        if (barRef.current) barRef.current.style.width = `${pct}%`;
        if (handleRef.current) handleRef.current.style.left = `calc(${pct}% - ${inset}px)`;
      }
    };

    const onSeeked = () => {
      const v = videoRef.current;
      if (v && v.duration > 0) {
        const pct = (v.currentTime / v.duration) * 100;
        progressRef.current = pct;
        if (barRef.current) barRef.current.style.width = `${pct}%`;
        if (handleRef.current) handleRef.current.style.left = `calc(${pct}% - ${inset}px)`;
      }
    };

    if (!video.paused && !video.ended) start();

    video.addEventListener('play', start);
    video.addEventListener('pause', stop);
    video.addEventListener('ended', stop);
    video.addEventListener('seeked', onSeeked);

    return () => {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      video.removeEventListener('play', start);
      video.removeEventListener('pause', stop);
      video.removeEventListener('ended', stop);
      video.removeEventListener('seeked', onSeeked);
    };
  }, [videoRef, handleInsetPx]);

  return { progressRef, durationRef, barRef, handleRef, timeRef };
}

function ThinSeekTrack({
  trackRef,
  progress,
  bufferedRanges,
  duration,
  barRef,
  handleRef,
  showHandle,
  mobileStyle,
  handleInsetPx,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onMouseLeave,
  onPointerLeave,
  onLostPointerCapture,
  onPointerCancel,
}: {
  trackRef: React.RefObject<HTMLDivElement | null>;
  progress: number;
  bufferedRanges: BufferedRange[];
  duration: number;
  barRef: React.RefObject<HTMLDivElement | null>;
  handleRef: React.RefObject<HTMLDivElement | null>;
  showHandle: boolean;
  mobileStyle: boolean;
  handleInsetPx: number;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onMouseLeave: () => void;
  onPointerLeave: () => void;
  onLostPointerCapture: () => void;
  onPointerCancel: () => void;
}) {
  const rail = (
    <>
      <BufferSegments
        ranges={bufferedRanges}
        duration={duration}
        className="bg-white/25 rounded-full"
      />
      <div
        ref={barRef}
        className="absolute top-0 left-0 h-full rounded-full bg-primary"
        style={{ width: `${progress}%` }}
      />
      <div
        ref={handleRef}
        className={cn(
          'absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow-md',
          mobileStyle ? 'opacity-100' : 'opacity-0 transition-opacity duration-150 group-hover/seek:opacity-100',
          showHandle && 'opacity-100'
        )}
        style={{ left: `calc(${progress}% - ${handleInsetPx}px)` }}
      />
    </>
  );

  if (mobileStyle) {
    return (
      <div
        ref={trackRef}
        tabIndex={-1}
        className="group/seek relative flex min-h-9 w-full cursor-pointer select-none items-center justify-center overflow-visible rounded-full bg-transparent outline-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onMouseLeave={onMouseLeave}
        onPointerLeave={onPointerLeave}
        onLostPointerCapture={onLostPointerCapture}
        onPointerCancel={onPointerCancel}
        onBlur={onMouseLeave}
      >
        <div className="relative h-[3px] w-full shrink-0 overflow-visible rounded-full bg-secondary">
          {rail}
        </div>
      </div>
    );
  }

  /**
   * Desktop: visual rail stays slim (4px → 8px on hover) but the pointer-target wrapper
   * is 20px tall so users don't need pixel-perfect aim. Events live on the outer wrapper;
   * the inner div renders the actual rail centered inside the hit area.
   */
  return (
    <div
      ref={trackRef}
      tabIndex={-1}
      className="group/seek relative flex h-5 w-full cursor-pointer select-none items-center overflow-visible bg-transparent outline-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onMouseLeave={onMouseLeave}
      onPointerLeave={onPointerLeave}
      onLostPointerCapture={onLostPointerCapture}
      onPointerCancel={onPointerCancel}
      onBlur={onMouseLeave}
    >
      <div className="relative h-1 w-full overflow-visible rounded-full bg-secondary transition-[height] duration-150 group-hover/seek:h-2">
        {rail}
      </div>
    </div>
  );
}

export default function SeekBar({ mobileStyle = false }: { mobileStyle?: boolean }) {
  const {
    videoRef,
    state,
    seek,
    play,
    pause,
    spriteMeta,
    spriteUrl,
    waveformUrl,
    startInteraction,
    endInteraction,
  } = usePlayerContext();
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const [trackWidth, setTrackWidth] = useState(0);
  const [waveformError, setWaveformError] = useState(false);
  const [pullReveal, setPullReveal] = useState(0);
  const pointerDownYRef = useRef(0);
  const isDraggingRef = useRef(false);
  /** True while pointer is down scrubbing — used to resume playback only after scrub ends */
  const scrubActiveRef = useRef(false);
  const wasPlayingBeforeScrubRef = useRef(false);

  const finishScrubbing = useCallback(() => {
    if (!scrubActiveRef.current) return;
    scrubActiveRef.current = false;
    const shouldResume = wasPlayingBeforeScrubRef.current;
    wasPlayingBeforeScrubRef.current = false;
    if (shouldResume) play();
  }, [play]);

  useEffect(() => {
    isDraggingRef.current = isDragging;
  }, [isDragging]);

  useEffect(() => {
    if (!state.controlsVisible) {
      setPullReveal(0);
      setHoverTime(null);
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        setIsDragging(false);
        finishScrubbing();
        endInteraction();
      }
    }
  }, [state.controlsVisible, endInteraction, finishScrubbing]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onSeeked = () => {
      if (isDraggingRef.current) return;
      setPullReveal(0);
    };
    v.addEventListener('seeked', onSeeked);
    return () => v.removeEventListener('seeked', onSeeked);
  }, [videoRef]);

  useEffect(() => {
    const onWinBlur = () => {
      setPullReveal(0);
      setHoverTime(null);
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        setIsDragging(false);
        finishScrubbing();
        endInteraction();
      }
    };
    window.addEventListener('blur', onWinBlur);
    return () => window.removeEventListener('blur', onWinBlur);
  }, [endInteraction, finishScrubbing]);

  const handleInsetPx = mobileStyle ? 8 : 8;
  const { barRef, handleRef } = useVideoProgress(videoRef, handleInsetPx);

  useEffect(() => {
    if (!waveformUrl) {
      setWaveformError(false);
      return;
    }
    setWaveformError(false);
  }, [waveformUrl]);

  const progress = state.duration > 0 ? (state.currentTime / state.duration) * 100 : 0;
  const { bufferedRanges } = state;

  const getTimeFromX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      const video = videoRef.current;
      if (!track || !video?.duration) return 0;
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ratio * video.duration;
    },
    [videoRef]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      pointerDownYRef.current = e.clientY;
      setPullReveal(0);
      const v = videoRef.current;
      if (v) {
        if (scrubActiveRef.current) finishScrubbing();
        wasPlayingBeforeScrubRef.current = !v.paused && !v.ended;
        scrubActiveRef.current = true;
        pause();
      }
      const track = trackRef.current;
      if (track) {
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        setHoverX(Math.max(0, Math.min(x, rect.width)));
        setTrackWidth(rect.width);
      }
      setHoverTime(getTimeFromX(e.clientX));
      isDraggingRef.current = true;
      setIsDragging(true);
      startInteraction();
      const time = getTimeFromX(e.clientX);
      seek(time);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [getTimeFromX, seek, startInteraction, videoRef, pause, finishScrubbing]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setHoverX(Math.max(0, Math.min(x, rect.width)));
      setTrackWidth(rect.width);
      setHoverTime(getTimeFromX(e.clientX));

      if (isDragging) {
        const dy = pointerDownYRef.current - e.clientY;
        setPullReveal(Math.min(1, Math.max(0, dy / PULL_REVEAL_PX)));
        seek(getTimeFromX(e.clientX));
      }
    },
    [isDragging, getTimeFromX, seek]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (isDragging) {
        isDraggingRef.current = false;
        setIsDragging(false);
        setPullReveal(0);
        setHoverTime(null);
        seek(getTimeFromX(e.clientX));
        finishScrubbing();
        endInteraction();
      }
    },
    [isDragging, getTimeFromX, seek, endInteraction, finishScrubbing]
  );

  const handleMouseLeave = useCallback(() => {
    if (!isDragging) {
      setHoverTime(null);
      setPullReveal(0);
    }
  }, [isDragging]);

  const handleLostPointerCapture = useCallback(() => {
    setPullReveal(0);
    setHoverTime(null);
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDragging(false);
    finishScrubbing();
    endInteraction();
  }, [endInteraction, finishScrubbing]);

  const handlePointerCancel = useCallback(() => {
    handleLostPointerCapture();
  }, [handleLostPointerCapture]);

  useEffect(() => {
    if (!isDragging) return;
    const handleGlobalUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      setIsDragging(false);
      setPullReveal(0);
      setHoverTime(null);
      finishScrubbing();
      endInteraction();
    };
    window.addEventListener('pointerup', handleGlobalUp);
    return () => window.removeEventListener('pointerup', handleGlobalUp);
  }, [isDragging, endInteraction, finishScrubbing]);

  const showWaveformStrip = Boolean(waveformUrl && !waveformError);
  const waveAreaPx = pullReveal * WAVEFORM_STRIP_HEIGHT;
  /** Idle: full hit area; pulled up: rail + waveform strip. */
  const trackHeightPx = waveAreaPx > 0.5 ? RAIL_HEIGHT_PX + waveAreaPx : HIT_AREA_HEIGHT_PX;
  const thumbShow =
    mobileStyle ||
    hoverTime !== null ||
    isDragging ||
    pullReveal > 0.04;
  const displayTime = hoverTime !== null ? hoverTime : state.currentTime;
  const showPullHint =
    showWaveformStrip && (hoverTime !== null || isDragging) && pullReveal < 0.2;

  if (waveformUrl) {
    return (
      <>
        <img
          src={waveformUrl}
          alt=""
          className="hidden"
          onError={() => setWaveformError(true)}
        />
        {!waveformError ? (
          <div className={cn('relative w-full group/seek px-0', mobileStyle && 'touch-none')}>
            {showPullHint && (
              <div className="pointer-events-none absolute bottom-full left-0 right-0 z-30 mb-1 flex items-center justify-center gap-1.5">
                <span className="text-[11px] font-medium text-white/90">Pull up for precise seeking</span>
                <ChevronsUp className="h-3.5 w-3.5 text-white/80" />
              </div>
            )}
            {hoverTime !== null && spriteMeta && spriteUrl && (
              <div className="pointer-events-none absolute bottom-full left-0 right-0 z-20 mb-2 flex justify-center">
                <ThumbnailPreview
                  meta={spriteMeta}
                  spriteUrl={spriteUrl}
                  time={hoverTime}
                  parentWidth={trackWidth}
                  cursorX={hoverX}
                />
              </div>
            )}
            <div
              ref={trackRef}
              tabIndex={-1}
              className={cn(
                'relative w-full cursor-pointer select-none overflow-hidden rounded-md transition-[height] duration-150 ease-out outline-none',
                /** Idle: invisible hit area on both desktop & mobile. The dark backdrop only shows up when the user pulls the waveform open. */
                waveAreaPx < 0.5 ? 'bg-transparent' : 'bg-black/50',
              )}
              style={{ height: Math.max(mobileStyle ? 16 : HIT_AREA_HEIGHT_PX, trackHeightPx) }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onMouseLeave={handleMouseLeave}
              onPointerLeave={handleMouseLeave}
              onLostPointerCapture={handleLostPointerCapture}
              onPointerCancel={handlePointerCancel}
              onBlur={handleMouseLeave}
            >
              <div
                className="absolute left-0 right-0 overflow-hidden transition-[height] duration-150 ease-out"
                style={{
                  bottom: RAIL_HEIGHT_PX,
                  height: waveAreaPx,
                }}
              >
                <div
                  className="absolute bottom-0 left-0 right-0 opacity-90"
                  style={{
                    height: WAVEFORM_STRIP_HEIGHT,
                    backgroundImage: `url(${waveformUrl})`,
                    backgroundSize: '100% 100%',
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'center',
                    filter: 'brightness(0) invert(1)',
                    mixBlendMode: 'lighten',
                  }}
                />
              </div>

              <div
                className={cn(
                  'absolute left-0 right-0 z-[1] h-1 bg-secondary',
                  /**
                   * Idle (no pull-reveal): center the rail in the 20px hit area for both
                   * desktop & mobile. Once the user pulls up to expose the waveform strip,
                   * pin the rail to the bottom so the strip can grow above it.
                   */
                  waveAreaPx < 0.5 ? 'top-1/2 bottom-auto -translate-y-1/2' : 'bottom-0',
                )}
              >
                <BufferSegments
                  ranges={bufferedRanges}
                  duration={state.duration}
                  className="bg-white/20 rounded-full"
                />
                <div
                  ref={barRef}
                  className="absolute top-0 left-0 h-full bg-primary"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <div
                ref={handleRef}
                className={cn(
                  'pointer-events-none absolute z-10 h-4 w-4 rounded-full border-2 border-primary bg-background shadow-md transition-opacity duration-150',
                  mobileStyle ? 'opacity-100' : 'opacity-0 group-hover/seek:opacity-100',
                  thumbShow && 'opacity-100'
                )}
                style={
                  /** Idle (rail centered in hit area): center the handle on the rail too. */
                  waveAreaPx < 0.5
                    ? {
                        left: `calc(${progress}% - ${handleInsetPx}px)`,
                        top: '50%',
                        transform: 'translateY(-50%)',
                      }
                    : {
                        left: `calc(${progress}% - ${handleInsetPx}px)`,
                        bottom: 0,
                        transform: 'translateY(50%)',
                      }
                }
              />

              {thumbShow && (
                <div
                  className="pointer-events-none absolute z-20 flex flex-col items-center"
                  style={
                    waveAreaPx < 0.5
                      ? {
                          left: `calc(${progress}%)`,
                          top: '50%',
                          transform: 'translateX(-50%) translateY(-50%)',
                        }
                      : {
                          left: `calc(${progress}%)`,
                          bottom: 0,
                          transform: 'translateX(-50%) translateY(50%)',
                        }
                  }
                >
                  <span className="-translate-y-full pt-0.5 text-xs font-medium whitespace-nowrap text-white drop-shadow-sm">
                    {formatTime(displayTime)}
                  </span>
                  <div
                    className="mt-0.5 w-px shrink-0 bg-white/90"
                    style={{ height: Math.max(8, waveAreaPx + 6) }}
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className={cn('relative w-full group/seek px-0', mobileStyle && 'touch-none')}>
            {hoverTime !== null && spriteMeta && spriteUrl && (
              <div className="pointer-events-none absolute bottom-full left-0 right-0 z-20 mb-2 flex justify-center">
                <ThumbnailPreview
                  meta={spriteMeta}
                  spriteUrl={spriteUrl}
                  time={hoverTime}
                  parentWidth={trackWidth}
                  cursorX={hoverX}
                />
              </div>
            )}
            <ThinSeekTrack
              trackRef={trackRef}
              progress={progress}
              bufferedRanges={bufferedRanges}
              duration={state.duration}
              barRef={barRef}
              handleRef={handleRef}
              showHandle={Boolean(hoverTime !== null || isDragging || mobileStyle)}
              mobileStyle={mobileStyle}
              handleInsetPx={handleInsetPx}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onMouseLeave={handleMouseLeave}
              onPointerLeave={handleMouseLeave}
              onLostPointerCapture={handleLostPointerCapture}
              onPointerCancel={handlePointerCancel}
            />
          </div>
        )}
      </>
    );
  }

  return (
    <div className={cn('relative w-full group/seek px-0', mobileStyle && 'touch-none')}>
      {hoverTime !== null && spriteMeta && spriteUrl && (
        <div className="pointer-events-none absolute bottom-full left-0 right-0 z-20 mb-2 flex justify-center">
          <ThumbnailPreview
            meta={spriteMeta}
            spriteUrl={spriteUrl}
            time={hoverTime}
            parentWidth={trackWidth}
            cursorX={hoverX}
          />
        </div>
      )}
      <ThinSeekTrack
        trackRef={trackRef}
        progress={progress}
        bufferedRanges={bufferedRanges}
        duration={state.duration}
        barRef={barRef}
        handleRef={handleRef}
        showHandle={Boolean(hoverTime !== null || isDragging || mobileStyle)}
        mobileStyle={mobileStyle}
        handleInsetPx={handleInsetPx}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onMouseLeave={handleMouseLeave}
        onPointerLeave={handleMouseLeave}
        onLostPointerCapture={handleLostPointerCapture}
        onPointerCancel={handlePointerCancel}
      />
    </div>
  );
}
