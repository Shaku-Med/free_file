import { useRef, useState, useCallback, useEffect } from 'react';
import { usePlayerContext } from '../../PlayerContext';
import type { BufferedRange } from '../../PlayerContext';
import ThumbnailPreview from './ThumbnailPreview';
import { formatTime } from './functions/formatTime';
import { cn } from '~/lib/utils';

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

const WAVEFORM_HEIGHT = 40;

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
  waveformUrl,
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
  waveformUrl?: string;
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

  if (waveformUrl) {
    return (
      <div
        ref={trackRef}
        tabIndex={-1}
        className="group/seek relative flex w-full cursor-pointer select-none items-end overflow-visible bg-transparent outline-none"
        style={{ height: WAVEFORM_HEIGHT }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onMouseLeave={onMouseLeave}
        onPointerLeave={onPointerLeave}
        onLostPointerCapture={onLostPointerCapture}
        onPointerCancel={onPointerCancel}
        onBlur={onMouseLeave}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-50 group-hover/seek:opacity-80 transition-opacity duration-200"
          style={{
            backgroundImage: `url(${waveformUrl})`,
            backgroundSize: '100% 100%',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
            filter: 'brightness(0) invert(1)',
            mixBlendMode: 'lighten',
          }}
        />
        <div className="relative h-1 w-full overflow-visible rounded-full bg-white/10 transition-[height] duration-150 group-hover/seek:h-1.5">
          {rail}
        </div>
      </div>
    );
  }

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
    const onWinBlur = () => {
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

  useEffect(() => {
    if (!waveformUrl) setWaveformError(false);
    else setWaveformError(false);
  }, [waveformUrl]);

  const showWaveform = Boolean(waveformUrl && !waveformError);

  const handleInsetPx = mobileStyle ? 8 : 8;
  const { barRef, handleRef } = useVideoProgress(videoRef, handleInsetPx);

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
    }
  }, [isDragging]);

  const handleLostPointerCapture = useCallback(() => {
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
      setHoverTime(null);
      finishScrubbing();
      endInteraction();
    };
    window.addEventListener('pointerup', handleGlobalUp);
    return () => window.removeEventListener('pointerup', handleGlobalUp);
  }, [isDragging, endInteraction, finishScrubbing]);

  return (
    <div className={cn('relative w-full group/seek px-0', mobileStyle && 'touch-none')}>
      {waveformUrl && (
        <img src={waveformUrl} alt="" className="hidden" onError={() => setWaveformError(true)} />
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
        waveformUrl={showWaveform ? waveformUrl : undefined}
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
