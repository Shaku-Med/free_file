import { useRef, useState, useCallback, useEffect } from 'react';
import { ChevronsUp } from 'lucide-react';
import { usePlayerContext } from '../../PlayerContext';
import type { BufferedRange } from '../../PlayerContext';
import ThumbnailPreview from './ThumbnailPreview';
import { formatTime } from './functions/formatTime';

const WAVEFORM_STRIP_HEIGHT = 40;

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

function useVideoProgress(videoRef: React.RefObject<HTMLVideoElement | null>) {
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

    const update = () => {
      if (!running) return;
      const v = videoRef.current;
      if (v && v.duration > 0) {
        const pct = (v.currentTime / v.duration) * 100;
        progressRef.current = pct;
        durationRef.current = v.duration;
        if (barRef.current) barRef.current.style.width = `${pct}%`;
        if (handleRef.current) handleRef.current.style.left = `calc(${pct}% - 6px)`;
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
        if (handleRef.current) handleRef.current.style.left = `calc(${pct}% - 6px)`;
      }
    };

    const onSeeked = () => {
      const v = videoRef.current;
      if (v && v.duration > 0) {
        const pct = (v.currentTime / v.duration) * 100;
        progressRef.current = pct;
        if (barRef.current) barRef.current.style.width = `${pct}%`;
        if (handleRef.current) handleRef.current.style.left = `calc(${pct}% - 6px)`;
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
  }, [videoRef]);

  return { progressRef, durationRef, barRef, handleRef, timeRef };
}

export default function SeekBar() {
  const {
    videoRef,
    state,
    seek,
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

  const { barRef, handleRef, timeRef } = useVideoProgress(videoRef);

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
      setIsDragging(true);
      startInteraction();
      const time = getTimeFromX(e.clientX);
      seek(time);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [getTimeFromX, seek, startInteraction]
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
        seek(getTimeFromX(e.clientX));
        setIsDragging(false);
        endInteraction();
      }
    },
    [isDragging, getTimeFromX, seek, endInteraction]
  );

  const handleMouseLeave = useCallback(() => {
    if (!isDragging) setHoverTime(null);
  }, [isDragging]);

  useEffect(() => {
    if (!isDragging) return;
    const handleGlobalUp = () => {
      setIsDragging(false);
      endInteraction();
    };
    window.addEventListener('pointerup', handleGlobalUp);
    return () => window.removeEventListener('pointerup', handleGlobalUp);
  }, [isDragging, endInteraction]);

  const showHandle = hoverTime !== null || isDragging;
  const displayTime = hoverTime !== null ? hoverTime : state.currentTime;

  const showWaveformStrip = waveformUrl && !waveformError;

  if (waveformUrl) {
    return (
      <>
        <img
          src={waveformUrl}
          alt=""
          className="hidden"
          onError={() => setWaveformError(true)}
        />
        {showWaveformStrip ? (
      <div className="relative w-full group/seek px-0">
        {hoverTime !== null && (
          <>
            <div className="absolute bottom-full left-0 right-0 flex items-center justify-center gap-1.5 mb-1 pointer-events-none">
              <span className="text-[11px] text-white/90 font-medium">Pull up for precise seeking</span>
              <ChevronsUp className="w-3.5 h-3.5 text-white/80" />
            </div>
            {spriteMeta && spriteUrl && (
              <ThumbnailPreview
                meta={spriteMeta}
                spriteUrl={spriteUrl}
                time={hoverTime}
                parentWidth={trackWidth}
                cursorX={hoverX}
              />
            )}
          </>
        )}

        <div
          ref={trackRef}
          className="relative w-full cursor-pointer select-none overflow-hidden rounded-md bg-black/50"
          style={{ height: WAVEFORM_STRIP_HEIGHT }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onMouseLeave={handleMouseLeave}
        >
          <div
            className="absolute inset-0 opacity-90"
            style={{
              backgroundImage: `url(${waveformUrl})`,
              backgroundSize: '100% 100%',
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'center',
              filter: 'brightness(0) invert(1)',
              mixBlendMode: 'lighten',
            }}
          />

          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-secondary">
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
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-primary bg-background shadow-md pointer-events-none transition-opacity duration-150 z-10"
            style={{
              left: `calc(${progress}% - 6px)`,
              opacity: showHandle ? 1 : 0,
            }}
          />

          {showHandle && (
            <div
              className="absolute pointer-events-none z-20 flex flex-col items-center"
              style={{
                left: `calc(${progress}%)`,
                top: 0,
                transform: 'translateX(-50%)',
              }}
            >
              <span ref={timeRef} className="text-xs font-medium text-white whitespace-nowrap -translate-y-full pt-0.5 drop-shadow-sm">
                {formatTime(displayTime)}
              </span>
              <div
                className="w-px bg-white/90 shrink-0 mt-0.5"
                style={{ height: WAVEFORM_STRIP_HEIGHT - 4 }}
              />
            </div>
          )}
        </div>
      </div>
        ) : (
          <div className="relative w-full group/seek px-0">
            {hoverTime !== null && (
              <>
                <div className="absolute bottom-full left-0 right-0 flex items-center justify-center gap-1.5 mb-1 pointer-events-none">
                  <span className="text-[11px] text-white/90 font-medium">Pull up for precise seeking</span>
                  <ChevronsUp className="w-3.5 h-3.5 text-white/80" />
                </div>
                {spriteMeta && spriteUrl && (
                  <ThumbnailPreview
                    meta={spriteMeta}
                    spriteUrl={spriteUrl}
                    time={hoverTime}
                    parentWidth={trackWidth}
                    cursorX={hoverX}
                  />
                )}
              </>
            )}
            <div
              ref={trackRef}
              className="relative h-[3px] group-hover/seek:h-[5px] transition-[height] duration-150 cursor-pointer select-none overflow-hidden rounded-full bg-secondary"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onMouseLeave={handleMouseLeave}
            >
              <BufferSegments
                ranges={bufferedRanges}
                duration={state.duration}
                className="bg-white/25 rounded-full"
              />
              <div
                ref={barRef}
                className="absolute top-0 left-0 h-full bg-primary rounded-full"
                style={{ width: `${progress}%` }}
              />
              <div
                ref={handleRef}
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-primary bg-background opacity-0 group-hover/seek:opacity-100 transition-opacity duration-150 shadow-md"
                style={{ left: `calc(${progress}% - 6px)` }}
              />
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="relative w-full group/seek px-0">
      {hoverTime !== null && (
        <>
          <div className="absolute bottom-full left-0 right-0 flex items-center justify-center gap-1.5 mb-1 pointer-events-none">
            <span className="text-[11px] text-white/90 font-medium">Pull up for precise seeking</span>
            <ChevronsUp className="w-3.5 h-3.5 text-white/80" />
          </div>
          {spriteMeta && spriteUrl && (
            <ThumbnailPreview
              meta={spriteMeta}
              spriteUrl={spriteUrl}
              time={hoverTime}
              parentWidth={trackWidth}
              cursorX={hoverX}
            />
          )}
        </>
      )}
      <div
        ref={trackRef}
        className="relative h-[3px] group-hover/seek:h-[5px] transition-[height] duration-150 cursor-pointer select-none overflow-hidden rounded-full bg-secondary"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onMouseLeave={handleMouseLeave}
      >
        <BufferSegments
          ranges={bufferedRanges}
          duration={state.duration}
          className="bg-white/25 rounded-full"
        />
        <div
          ref={barRef}
          className="absolute top-0 left-0 h-full bg-primary rounded-full"
          style={{ width: `${progress}%` }}
        />
        <div
          ref={handleRef}
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-primary bg-background opacity-0 group-hover/seek:opacity-100 transition-opacity duration-150 shadow-md"
          style={{ left: `calc(${progress}% - 6px)` }}
        />
      </div>
    </div>
  );
}
