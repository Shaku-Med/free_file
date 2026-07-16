import { useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { usePlayerContext } from '../../PlayerContext';
import type { BufferedRange } from '../../PlayerContext';
import ThumbnailPreview from './ThumbnailPreview';
import { formatTime } from './functions/formatTime';
import { parseChapters, activeChapterIndex, type Chapter } from './functions/parseChapters';
import WaveformCanvas, {
  isWaveformJson,
  fetchPeaks,
  getCachedPeaks,
  isPeaksMissing,
} from './WaveformCanvas';
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

/** YouTube-style gap markers at each chapter boundary (skips the 0:00 start). */
function ChapterTicks({ chapters, duration }: { chapters: Chapter[]; duration: number }) {
  if (duration <= 0 || chapters.length < 2) return null;
  return (
    <>
      {chapters.map((ch, i) => {
        if (i === 0 || ch.start <= 0 || ch.start >= duration) return null;
        const left = (ch.start / duration) * 100;
        return (
          <div
            key={ch.start}
            className="absolute top-1/2 z-[1] h-[140%] w-[2px] -translate-y-1/2 rounded-full bg-background/80"
            style={{ left: `${left}%` }}
            aria-hidden
          />
        );
      })}
    </>
  );
}

function useVideoProgress(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  handleInsetPx: number,
  useScaledInset = false,
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
    const insetExpr = useScaledInset
      ? `var(--hls-ctrl-seek-handle-inset, ${handleInsetPx}px)`
      : `${handleInsetPx}px`;

    const update = () => {
      if (!running) return;
      const v = videoRef.current;
      if (v && v.duration > 0) {
        const pct = (v.currentTime / v.duration) * 100;
        progressRef.current = pct;
        durationRef.current = v.duration;
        if (barRef.current) barRef.current.style.width = `${pct}%`;
        if (handleRef.current) handleRef.current.style.left = `calc(${pct}% - ${insetExpr})`;
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
        if (handleRef.current) handleRef.current.style.left = `calc(${pct}% - ${insetExpr})`;
      }
    };

    const onSeeked = () => {
      const v = videoRef.current;
      if (v && v.duration > 0) {
        const pct = (v.currentTime / v.duration) * 100;
        progressRef.current = pct;
        if (barRef.current) barRef.current.style.width = `${pct}%`;
        if (handleRef.current) handleRef.current.style.left = `calc(${pct}% - ${insetExpr})`;
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
  }, [videoRef, handleInsetPx, useScaledInset]);

  return { progressRef, durationRef, barRef, handleRef, timeRef };
}

const WAVEFORM_HEIGHT = 40;

function ThinSeekTrack({
  trackRef,
  progress,
  bufferedRanges,
  duration,
  chapters,
  barRef,
  handleRef,
  showHandle,
  mobileStyle,
  scaledStyle,
  flushBottom,
  flushTop = false,
  handleInsetPx,
  waveformUrl,
  trackWidth,
  onWaveformError,
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
  chapters: Chapter[];
  barRef: React.RefObject<HTMLDivElement | null>;
  handleRef: React.RefObject<HTMLDivElement | null>;
  showHandle: boolean;
  mobileStyle: boolean;
  scaledStyle: boolean;
  /** Sit the visible track on the bottom edge (mini dock divider). */
  flushBottom: boolean;
  /** Sit the visible track on the top edge (mobile music bar). */
  flushTop?: boolean;
  handleInsetPx: number;
  waveformUrl?: string;
  trackWidth: number;
  onWaveformError: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onMouseLeave: () => void;
  onPointerLeave: () => void;
  onLostPointerCapture: () => void;
  onPointerCancel: () => void;
}) {
  const handleLeft = scaledStyle
    ? `calc(${progress}% - var(--hls-ctrl-seek-handle-inset, ${handleInsetPx}px))`
    : `calc(${progress}% - ${handleInsetPx}px)`;
  const handleSizeClass = scaledStyle
    ? 'h-[var(--hls-ctrl-seek-handle,1rem)] w-[var(--hls-ctrl-seek-handle,1rem)]'
    : 'h-4 w-4';

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
      <ChapterTicks chapters={chapters} duration={duration} />
      <div
        ref={handleRef}
        className={cn(
          'absolute top-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow-md',
          handleSizeClass,
          mobileStyle ? 'opacity-100' : 'opacity-0 transition-opacity duration-150 group-hover/seek:opacity-100',
          showHandle && 'opacity-100'
        )}
        style={{ left: handleLeft }}
      />
    </>
  );

  if (mobileStyle) {
    return (
      <div
        ref={trackRef}
        tabIndex={-1}
        className={cn(
          'group/seek relative flex w-full cursor-pointer select-none justify-center overflow-visible rounded-full bg-transparent outline-none min-h-[var(--hls-ctrl-seek-hit,2.25rem)]',
          // Hit area still tall upward; visible rail sits on the bottom edge
          // so mini dock aligns with the title/queue divider (no floating gap).
          flushBottom ? 'items-end' : flushTop ? 'items-start' : 'items-center',
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onMouseLeave={onMouseLeave}
        onPointerLeave={onPointerLeave}
        onLostPointerCapture={onLostPointerCapture}
        onPointerCancel={onPointerCancel}
        onBlur={onMouseLeave}
      >
        <div className="relative h-[var(--hls-ctrl-seek-track,3px)] w-full shrink-0 overflow-visible rounded-full bg-secondary">
          {rail}
        </div>
      </div>
    );
  }

  if (waveformUrl) {
    // YouTube-style two-layer waveform:
    //   - bottom layer: unplayed bars in muted-foreground
    //   - top layer:    played bars in primary, clipped to progress %
    // PNG legacy fallback keeps old uploads working until they re-process.
    const isJson = isWaveformJson(waveformUrl);
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
        {isJson ? (
          <>
            {/* Unplayed waveform  muted-foreground, fades a touch more
                until hover so the primary fill pops. Only this canvas
                wires onError; the played-layer canvas above shares the
                same URL and would fire a redundant callback. */}
            <div className="pointer-events-none absolute inset-0 text-muted-foreground opacity-60 transition-opacity duration-200 group-hover/seek:opacity-80">
              <WaveformCanvas
                url={waveformUrl}
                height={WAVEFORM_HEIGHT}
                onError={onWaveformError}
              />
            </div>

            {/* Buffered ranges  rendered as semi-opaque foreground bars
                over the unplayed waveform. Same color family as played
                but lower opacity, so the eye reads: muted → buffered →
                played, like YouTube. Each range gets its own clip box;
                the inner canvas is positioned in pixels relative to the
                whole track so the bars stay aligned with the muted and
                primary layers underneath. */}
            {duration > 0 &&
              trackWidth > 0 &&
              bufferedRanges.map((range, i) => {
                const leftPx = (range.start / duration) * trackWidth;
                const widthPx = ((range.end - range.start) / duration) * trackWidth;
                if (widthPx <= 0) return null;
                return (
                  <div
                    key={i}
                    className="pointer-events-none absolute inset-y-0 overflow-hidden text-foreground/70 opacity-35 transition-opacity duration-200 group-hover/seek:opacity-50"
                    style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                  >
                    <div
                      className="absolute inset-y-0"
                      style={{ left: `${-leftPx}px`, width: `${trackWidth}px` }}
                    >
                      <WaveformCanvas url={waveformUrl} height={WAVEFORM_HEIGHT} />
                    </div>
                  </div>
                );
              })}

            {/* Played waveform  primary, clipped to progress%. The inner
                canvas always renders at the track's full pixel width so
                that as the clip grows the bars stay aligned with the
                muted layer underneath. */}
            <div
              ref={barRef}
              className="pointer-events-none absolute inset-y-0 left-0 overflow-hidden text-primary"
              style={{ width: `${progress}%` }}
            >
              <div
                className="absolute inset-y-0 left-0"
                style={{ width: trackWidth || '100%' }}
              >
                <WaveformCanvas url={waveformUrl} height={WAVEFORM_HEIGHT} />
              </div>
            </div>

            {/* Scrubber handle */}
            <div
              ref={handleRef}
              className={cn(
                'absolute top-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow-md',
                handleSizeClass,
                mobileStyle
                  ? 'opacity-100'
                  : 'opacity-0 transition-opacity duration-150 group-hover/seek:opacity-100',
                showHandle && 'opacity-100'
              )}
              style={{ left: handleLeft }}
            />

            {/* Hairline + buffered ranges sit on top of everything else so
                a flat-line waveform (silent video) still has a clear track. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border" />
            <BufferSegments
              ranges={bufferedRanges}
              duration={duration}
              className="bg-white/15 rounded-full bottom-0 top-auto h-px"
            />
          </>
        ) : (
          <>
            {/* Legacy PNG waveform  displayed ABOVE a normal thin rail.
                The PNG is fixed in the top portion of the track; the rail
                sits at the bottom and behaves like the no-waveform case.
                Themed to text-primary via filter so it picks up shadcn. */}
            <div
              className="pointer-events-none absolute inset-x-0 top-0 opacity-60 group-hover/seek:opacity-90 transition-opacity duration-200"
              style={{
                height: WAVEFORM_HEIGHT - 6,
                backgroundImage: `url(${waveformUrl})`,
                backgroundSize: '100% 100%',
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'center',
                filter: 'brightness(0) invert(1)',
                mixBlendMode: 'lighten',
              }}
            />
            {/* Thin rail at the bottom  same as the no-waveform branch
                so the seek/scrub UX matches. */}
            <div className="absolute inset-x-0 bottom-0 flex items-center pb-0.5">
              <div className="relative h-1 w-full overflow-visible rounded-full bg-secondary transition-[height] duration-150 group-hover/seek:h-1.5">
                {rail}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      ref={trackRef}
      tabIndex={-1}
      className={cn(
        'group/seek relative flex w-full cursor-pointer select-none items-center overflow-visible bg-transparent outline-none',
        scaledStyle
          ? 'min-h-[var(--hls-ctrl-seek-hit,1.25rem)]'
          : 'h-5',
      )}
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
        className={cn(
          'relative w-full overflow-visible rounded-full bg-secondary',
          scaledStyle
            ? 'h-[var(--hls-ctrl-seek-track,4px)] transition-[height] duration-150 group-hover/seek:h-[calc(var(--hls-ctrl-seek-track,4px)*1.5)]'
            : 'h-1 transition-[height] duration-150 group-hover/seek:h-2',
        )}
      >
        {rail}
      </div>
    </div>
  );
}

export default function SeekBar({
  mobileStyle = false,
  scaledStyle = false,
  flushBottom = false,
  flushTop = false,
  disablePreview = false,
}: {
  mobileStyle?: boolean;
  scaledStyle?: boolean;
  /** Align the rail to the bottom of the hit area (mini player divider). */
  flushBottom?: boolean;
  /** Align the rail to the top of the hit area (mobile music bar). */
  flushTop?: boolean;
  /** Skip scrub thumbnail hover (music bar — preview blocked shell taps). */
  disablePreview?: boolean;
}) {
  const {
    videoRef,
    state,
    seek,
    play,
    pause,
    spriteMeta,
    spriteUrl,
    waveformUrl: waveformJsonUrl,
    waveformPngUrl,
    startInteraction,
    endInteraction,
    isReel,
    file,
  } = usePlayerContext();
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  // Chapters parsed from the description (0:00-style lines). Reels never have them.
  const chapters = useMemo(
    () => (isReel ? [] : parseChapters(file?.file_description, state.duration)),
    [isReel, file?.file_description, state.duration],
  );
  const hoverChapterTitle =
    hoverTime != null && chapters.length > 0
      ? chapters[activeChapterIndex(chapters, hoverTime)]?.title ?? null
      : null;
  const [trackWidth, setTrackWidth] = useState(0);
  // Two separate error flags  the JSON path failing should not poison
  // the PNG fallback attempt, and vice versa.
  const [jsonError, setJsonError] = useState(false);
  const [pngError, setPngError] = useState(false);
  // The JSON peaks are fetched asynchronously inside WaveformCanvas. Until
  // they actually land we must NOT switch the track to the waveform layout,
  // otherwise the seeker shows a blank strip (just a hairline) while the
  // request is in flight  the bug this guards against. `jsonReady` flips
  // true only once usable peaks exist, so the plain progress rail stays up
  // during the request and the waveform swaps in cleanly when it's ready.
  const [jsonReady, setJsonReady] = useState(false);

  const hasJsonCandidate =
    !isReel &&
    Boolean(waveformJsonUrl) &&
    !jsonError &&
    isWaveformJson(waveformJsonUrl);
  // JSON exists for this file but its peaks haven't loaded yet  hold the
  // default rail (don't fall through to PNG, which would flicker once the
  // JSON resolves).
  const jsonPending = hasJsonCandidate && !jsonReady;

  // Resolve which waveform URL to actually render this frame:
  //   1. JSON peaks loaded → render the client-side waveform.
  //   2. JSON still loading → null (plain rail), wait for it.
  //   3. JSON 404s / silent → try PNG (legacy).
  //   4. PNG 404s too → null, SeekBar renders the plain rail.
  // Reels use the plain progress rail (same as mobile), not the waveform seeker.
  const waveformUrl = isReel
    ? null
    : hasJsonCandidate && jsonReady
      ? waveformJsonUrl
      : !jsonPending && waveformPngUrl && !pngError
        ? waveformPngUrl
        : null;
  const isDraggingRef = useRef(false);
  /** True while pointer is down scrubbing  used to resume playback only after scrub ends */
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

  // Reset error/ready flags whenever the underlying file changes  a 404
  // on one video shouldn't poison the next one even if it succeeds  then
  // pre-load the JSON peaks so we only flip to the waveform layout once
  // they're actually available. While the request is in flight the seeker
  // stays on the plain rail instead of rendering a blank waveform strip.
  useEffect(() => {
    setJsonError(false);
    setPngError(false);
    setJsonReady(false);

    if (isReel || !waveformJsonUrl || !isWaveformJson(waveformJsonUrl)) return;

    // Warm-cache hit (file revisit): show the waveform immediately.
    if (getCachedPeaks(waveformJsonUrl)) {
      setJsonReady(true);
      return;
    }
    // Already known to be missing/silent: skip straight to the fallback.
    if (isPeaksMissing(waveformJsonUrl)) {
      setJsonError(true);
      return;
    }

    let alive = true;
    fetchPeaks(waveformJsonUrl).then((peaks) => {
      if (!alive) return;
      if (peaks) setJsonReady(true);
      else setJsonError(true);
    });
    return () => {
      alive = false;
    };
  }, [waveformJsonUrl, waveformPngUrl, isReel]);

  // Stable callbacks for child error handlers  flagging one variant as
  // missing falls through to the next branch in the URL resolution above.
  const handleJsonError = useCallback(() => setJsonError(true), []);
  const handlePngError = useCallback(() => setPngError(true), []);
  // Aliased for the existing ThinSeekTrack prop name. The JSON renderer
  // is the only one that calls this; the PNG branch uses <img onError>.
  const handleWaveformError = handleJsonError;

  // Keep trackWidth in sync with the actual rendered width so the played
  // waveform layer sizes its inner canvas correctly before the first
  // pointer event. Without this, the clipped canvas would inherit the
  // played-fraction width and the bars would scale instead of mask.
  // useLayoutEffect so the synchronous initial measurement lands before
  // the first paint  no width-flash on mount.
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const initial = el.getBoundingClientRect().width;
    if (initial > 0) setTrackWidth(initial);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setTrackWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
    // Re-attach when the track layout swaps (plain rail ↔ waveform) so the
    // observer follows the new DOM node and the played-waveform layer gets a
    // correct pixel width after the swap.
  }, [waveformUrl, mobileStyle]);

  const showWaveform = Boolean(waveformUrl);

  const handleInsetPx = 8;
  const { barRef, handleRef } = useVideoProgress(videoRef, handleInsetPx, scaledStyle || mobileStyle);

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
    // `touch-pan-y` on mobile lets the browser keep ownership of
    // vertical pan gestures (so the user can scroll the page when their
    // finger lands on the seek bar) while still letting our pointer
    // handlers receive horizontal swipes for scrubbing. Previously this
    // was `touch-none`, which captured ALL gestures and silently broke
    // page scroll over the bar.
    <div className={cn('relative w-full group/seek px-0', mobileStyle && 'touch-pan-y')}>
      {/* PNG legacy preload  only fires when we've fallen back to the
          PNG branch. Flags the PNG-specific error flag so the resolution
          ladder above can drop the whole waveform if even the PNG 404s.
          JSON peaks are loaded inside WaveformCanvas. */}
      {waveformUrl && !isWaveformJson(waveformUrl) && (
        <img src={waveformUrl} alt="" className="hidden" onError={handlePngError} />
      )}
      {hoverTime !== null && !disablePreview && spriteMeta && spriteUrl && (
        <ThumbnailPreview
          meta={spriteMeta}
          spriteUrl={spriteUrl}
          time={hoverTime}
          parentWidth={trackWidth}
          cursorX={hoverX}
          caption={hoverChapterTitle ?? undefined}
          tight={mobileStyle}
          flushBottom={flushBottom}
          flushTop={flushTop}
        />
      )}
      {hoverTime !== null && !disablePreview && hoverChapterTitle && !(spriteMeta && spriteUrl) && (
        <div
          className="pointer-events-none absolute left-0 right-0 z-20 flex justify-center"
          style={
            mobileStyle
              ? {
                  bottom: flushBottom
                    ? 'calc(var(--hls-ctrl-seek-track, 3px) + 4px)'
                    : 'calc((var(--hls-ctrl-seek-hit, 2.25rem) + var(--hls-ctrl-seek-track, 3px)) / 2 + 4px)',
                }
              : { bottom: '100%', marginBottom: 8 }
          }
        >
          <span className="max-w-[70%] truncate rounded-md bg-black/85 px-2 py-1 text-[11px] font-medium text-white shadow-md">
            {hoverChapterTitle}
          </span>
        </div>
      )}
      <ThinSeekTrack
        trackRef={trackRef}
        progress={progress}
        bufferedRanges={bufferedRanges}
        duration={state.duration}
        chapters={chapters}
        barRef={barRef}
        handleRef={handleRef}
        showHandle={Boolean(hoverTime !== null || isDragging || mobileStyle)}
        mobileStyle={mobileStyle}
        scaledStyle={scaledStyle || mobileStyle}
        flushBottom={flushBottom}
        flushTop={flushTop}
        handleInsetPx={handleInsetPx}
        waveformUrl={showWaveform ? (waveformUrl ?? undefined) : undefined}
        trackWidth={trackWidth}
        onWaveformError={handleWaveformError}
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
