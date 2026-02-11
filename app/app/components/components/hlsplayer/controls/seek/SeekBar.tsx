import { useRef, useState, useCallback, useEffect } from 'react';
import { ChevronsUp } from 'lucide-react';
import { usePlayerContext } from '../../PlayerContext';
import ThumbnailPreview from './ThumbnailPreview';
import { formatTime } from './functions/formatTime';

const WAVEFORM_STRIP_HEIGHT = 40;

export default function SeekBar() {
  const { state, seek, spriteMeta, spriteUrl, waveformUrl, startInteraction, endInteraction } =
    usePlayerContext();
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const [trackWidth, setTrackWidth] = useState(0);
  const [waveformError, setWaveformError] = useState(false);

  useEffect(() => {
    if (!waveformUrl) {
      setWaveformError(false);
      return;
    }
    setWaveformError(false);
  }, [waveformUrl]);

  const progress = state.duration > 0 ? (state.currentTime / state.duration) * 100 : 0;
  const buffered = state.duration > 0 ? (state.buffered / state.duration) * 100 : 0;

  const getTimeFromX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track || !state.duration) return 0;
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ratio * state.duration;
    },
    [state.duration]
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
          {/* White outline waveform - no fill, no reflection */}
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

          {/* Thin progress bar at bottom: secondary = unplayed, primary = played */}
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-secondary">
            <div
              className="absolute top-0 left-0 h-full bg-primary"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Primary circular seeker handle */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-primary bg-background shadow-md pointer-events-none transition-opacity duration-150 z-10"
            style={{
              left: `calc(${progress}% - 6px)`,
              opacity: showHandle ? 1 : 0,
            }}
          />

          {/* Time above handle + vertical white guide line down to bottom (like image) */}
          {showHandle && (
            <div
              className="absolute pointer-events-none z-20 flex flex-col items-center"
              style={{
                left: `calc(${progress}%)`,
                top: 0,
                transform: 'translateX(-50%)',
              }}
            >
              <span className="text-xs font-medium text-white whitespace-nowrap -translate-y-full pt-0.5 drop-shadow-sm">
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
              <div
                className="absolute top-0 left-0 h-full rounded-full bg-secondary/80"
                style={{ width: `${buffered}%` }}
              />
              <div
                className="absolute top-0 left-0 h-full bg-primary rounded-full"
                style={{ width: `${progress}%` }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-primary bg-background opacity-0 group-hover/seek:opacity-100 transition-opacity duration-150 shadow-md"
                style={{ left: `calc(${progress}% - 6px)` }}
              />
            </div>
          </div>
        )}
      </>
    );
  }

  /* No waveform URL: classic thin seek bar */
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
        <div
          className="absolute top-0 left-0 h-full rounded-full bg-secondary/80"
          style={{ width: `${buffered}%` }}
        />
        <div
          className="absolute top-0 left-0 h-full bg-primary rounded-full"
          style={{ width: `${progress}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-primary bg-background opacity-0 group-hover/seek:opacity-100 transition-opacity duration-150 shadow-md"
          style={{ left: `calc(${progress}% - 6px)` }}
        />
      </div>
    </div>
  );
}
