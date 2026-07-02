import { useEffect, useLayoutEffect, useState, useCallback } from "react";
import { flushSync } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X, Maximize2, Loader2 } from "lucide-react";
import { useMiniPlayerContext, isReelPath } from "~/lib/Context/MiniPlayerContext";
import { useWatchSurfaceVideoRef } from "~/lib/Context/WatchSurfaceVideoRefContext";
import { useMainPlayerSlot } from "~/lib/Context/MainPlayerSlotContext";
import { ParseFilename } from "~/lib/utils";
import { cn } from "~/lib/utils";
import { useMiniPlayerDrag } from "./useMiniPlayerDrag";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import Ambience from "~/components/accessories/CanvasGradient/Ambience";

function MiniPlayerContent() {
  const {
    miniPlayer,
    closeMiniPlayer,
    containerRef,
    setContainerReady,
    isExpanding,
    startExpand,
  } = useMiniPlayerContext();
  const { setMiniSlot } = useMainPlayerSlot();
  const watchVideoRef = useWatchSurfaceVideoRef();
  const navigate = useNavigate();
  const sessionKey = miniPlayer?.file.unique_id ?? "";
  const {
    elementRef,
    position,
    frameWidth,
    tuck,
    isSnapping,
    isDragging,
    mounted,
    handlePointerDown,
    handleResizePointerDown,
    handleResizePointerMove,
    handleResizePointerUp,
  } = useMiniPlayerDrag(sessionKey);
  const [closing, setClosing] = useState(false);

  // Follow the video's real shape: seed from the upload metadata (instant, no
  // 16:9 flash) and refine from the element once it knows its dimensions.
  const [videoAspect, setVideoAspect] = useState<number | null>(null);
  useEffect(() => {
    setVideoAspect(null);
    const meta = (miniPlayer?.file as { metadata?: { video?: { width?: unknown; height?: unknown } } } | undefined)
      ?.metadata?.video;
    const mw = Number(meta?.width);
    const mh = Number(meta?.height);
    if (mw > 0 && mh > 0) setVideoAspect(mw / mh);
    const v = watchVideoRef.current;
    if (!v) return;
    const apply = () => {
      if (v.videoWidth > 0 && v.videoHeight > 0) setVideoAspect(v.videoWidth / v.videoHeight);
    };
    apply();
    v.addEventListener("loadedmetadata", apply);
    return () => v.removeEventListener("loadedmetadata", apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, watchVideoRef]);
  // Clamp so a portrait mini stays hand-sized (height <= 1.6x width) and an
  // ultra-wide one doesn't collapse into a sliver.
  const shellAspect = Math.min(Math.max(videoAspect ?? 16 / 9, 0.625), 2.4);

  // Viewport height cap: the whole mini (chrome included) may never exceed
  // ~52% of the screen. Without this a 9:16 video at phone width becomes a
  // near-fullscreen "mini" player. The width shrinks to satisfy the cap, so
  // portrait videos render as a slim column, like YouTube's portrait mini.
  const MINI_CHROME_H = 88; // drag header (36) + title footer (~52)
  const [viewportH, setViewportH] = useState<number>(() =>
    typeof window === "undefined" ? 800 : window.innerHeight,
  );
  useEffect(() => {
    const onResize = () => setViewportH(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const maxShellH = Math.max(160, Math.floor(viewportH * 0.52) - MINI_CHROME_H);
  const displayWidth = Math.min(frameWidth, Math.max(180, Math.floor(maxShellH * shellAspect)));

  // Ambient glow around the mini, honoring the SAME player setting as the watch
  // page (player-ambient-mode cookie). Re-read per mini session.
  const [ambientOn, setAmbientOn] = useState(false);
  useEffect(() => {
    try {
      let on = false;
      for (const cookie of document.cookie ? document.cookie.split("; ") : []) {
        const [key, value] = cookie.split("=");
        if (key === "player-ambient-mode") on = decodeURIComponent(value ?? "") === "1";
      }
      setAmbientOn(on);
    } catch {
      setAmbientOn(false);
    }
  }, [sessionKey]);

  const bindVideoShellRef = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el;
      setMiniSlot(el);
    },
    [containerRef, setMiniSlot],
  );

  useEffect(() => {
    if (miniPlayer) setContainerReady(true);
    return () => setContainerReady(false);
  }, [miniPlayer, setContainerReady]);

  useEffect(() => () => setMiniSlot(null), [setMiniSlot]);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      closeMiniPlayer();
      setClosing(false);
    }, 200);
  }, [closeMiniPlayer]);

  const handleExpand = useCallback(() => {
    if (!miniPlayer || isExpanding) return;
    const video = watchVideoRef.current;
    flushSync(() => {
      startExpand({
        fileId: miniPlayer.file.unique_id,
        currentTime: video?.currentTime ?? miniPlayer.currentTime ?? 0,
        volume: video?.volume ?? miniPlayer.volume ?? 1,
        muted: video?.muted ?? miniPlayer.muted ?? false,
        playbackRate: video?.playbackRate ?? miniPlayer.playbackRate ?? 1,
        wasPlaying: video ? !video.paused : (miniPlayer.wasPlaying ?? false),
      });
    });
    navigate(`/${miniPlayer.file.unique_id}`);
  }, [miniPlayer, isExpanding, startExpand, navigate, watchVideoRef]);

  if (!miniPlayer) return null;

  const title = miniPlayer.file.file_title || ParseFilename(miniPlayer.file.filename);
  const titleStr = typeof title === "string" ? title : (title as string[]).join("");

  return (
    <motion.div
      ref={elementRef}
      data-mini-player
      initial={false}
      animate={{ width: displayWidth }}
      transition={
        isDragging ? { duration: 0 }
          : { type: "tween", duration: isSnapping ? 0.2 : 0.15, ease: "easeOut" }
      }
      className={cn(
        "fixed z-[var(--z-mini-player)] max-w-[calc(100vw-1.5rem)] overflow-visible",
        closing && "opacity-0 scale-95 translate-y-3",
        !closing && mounted && "opacity-100 scale-100 translate-y-0",
        !mounted && "opacity-0",
      )}
      style={{
        left: position.x,
        top: position.y,
        width: displayWidth,
        isolation: "isolate",
        transition: isDragging
          ? "none"
          : isSnapping
            ? "left 200ms ease-out, top 200ms ease-out, opacity 200ms ease, transform 200ms ease"
            : mounted
              ? "left 180ms ease-out, top 180ms ease-out, opacity 200ms ease, transform 200ms ease"
              : "none",
        willChange: isDragging ? ('left, top, width') : ('opacity, transform'),
      }}
    >
      {tuck === "right" && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Drag to pull mini player back"
          className={cn(
            "absolute left-0 top-1/2 z-[50] -translate-x-[72%] -translate-y-1/2",
            "pointer-events-auto",
            "h-16 w-[15px] cursor-grab touch-none select-none rounded-full active:cursor-grabbing",
            "border border-white/20 bg-black/55 shadow-md",
          )}
          style={{ isolation: "isolate" }}
          onPointerDown={handlePointerDown}
        />
      )}
      {tuck === "left" && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Drag to pull mini player back"
          className={cn(
            "absolute right-0 top-1/2 z-[50] translate-x-[72%] -translate-y-1/2",
            "pointer-events-auto",
            "h-16 w-[15px] cursor-grab touch-none select-none rounded-full active:cursor-grabbing",
            "border border-white/20 bg-black/55 shadow-md",
          )}
          style={{ isolation: "isolate" }}
          onPointerDown={handlePointerDown}
        />
      )}

      {/* Ambient glow: the live video palette feathering out past the card. Only
          when the player's ambient setting is on, and never while tucked away at
          a screen edge (a colorful smear poking out looks broken). The blur
          itself feathers the edges - tiny canvas, sampled at 1fps, so it costs
          next to nothing even on phones. */}
      {ambientOn && !tuck && !closing && (
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-[14%] -z-[1] rounded-[2.5rem] opacity-75 blur-2xl saturate-150"
        >
          <Ambience key={sessionKey} colors={[]} videoRef={watchVideoRef} videoReady sync={false} />
        </div>
      )}

      <div
        className={cn(
          "overflow-hidden rounded-xl border border-border bg-black",
          "shadow-lg shadow-black/40",
        )}
      >
        <div
          className="flex h-9 cursor-grab touch-none select-none items-center bg-zinc-900/95 px-1.5 active:cursor-grabbing"
          onPointerDown={handlePointerDown}
          aria-label="Drag to move mini player"
        >
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex shrink-0">
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  handleExpand();
                }}
                disabled={isExpanding}
                className={cn(
                  "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors touch-manipulation",
                  isExpanding
                    ? "cursor-wait text-white/50"
                    : "text-white/70 hover:bg-white/10 hover:text-white active:bg-white/20",
                )}
                aria-label={isExpanding ? "Loading full player..." : "Expand to full player"}
              >
                {isExpanding ? (
                  <Loader2 className="h-[15px] w-[15px] animate-spin" />
                ) : (
                  <Maximize2 className="h-[15px] w-[15px]" />
                )}
              </button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            {isExpanding ? "Waiting for the full player to load…" : "Expand"}
          </TooltipContent>
        </Tooltip>

        <div className="flex flex-1 justify-center">
          <div className="h-[3px] w-8 rounded-full bg-white/20" />
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                handleClose();
              }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white active:bg-white/20 touch-manipulation"
              aria-label="Close mini player"
            >
              <X className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Close</TooltipContent>
        </Tooltip>
      </div>

      <div
        ref={bindVideoShellRef}
        className={cn(
          "relative w-full overflow-hidden bg-black",
          `mini_player_inner_${miniPlayer.imageID}`,
        )}
        // Follows the video's real aspect (portrait mini for portrait videos)
        // instead of forcing everything into a 16:9 box.
        style={{ aspectRatio: String(shellAspect) }}
      />

      <div className="bg-zinc-900/95 px-3 py-2.5">
        <p className="truncate text-xs font-medium leading-snug text-white/90">{titleStr}</p>
        {miniPlayer.file.owner?.username && (
          <p className="mt-0.5 truncate text-[11px] text-white/40">{miniPlayer.file.owner.username}</p>
        )}
      </div>

      <div
        className="absolute bottom-10 right-2 z-20 h-5 w-5 cursor-nwse-resize touch-none rounded-md border border-white/25 bg-black/70 shadow-sm hover:bg-black/85"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerUp}
        onPointerCancel={handleResizePointerUp}
        aria-label="Resize mini player"
        role="slider"
        aria-valuemin={260}
        aria-valuemax={520}
      />
      </div>
    </motion.div>
  );
}

/** Reel surface owns the global player while user is on `/reel*` — mini is suspended, not closed. */
export default function MiniPlayer() {
  const { miniPlayer, suspendMiniPlayerForReel } = useMiniPlayerContext();
  const watchVideoRef = useWatchSurfaceVideoRef();
  const location = useLocation();
  const onReel = isReelPath(location.pathname);

  useLayoutEffect(() => {
    if (!onReel || !miniPlayer) return;
    const video = watchVideoRef.current;
    suspendMiniPlayerForReel({
      ...miniPlayer,
      src: miniPlayer.src,
      currentTime: video?.currentTime ?? miniPlayer.currentTime ?? 0,
      wasPlaying: video ? !video.paused : (miniPlayer.wasPlaying ?? false),
      volume: video?.volume ?? miniPlayer.volume ?? 1,
      muted: video?.muted ?? miniPlayer.muted ?? false,
      playbackRate: video?.playbackRate ?? miniPlayer.playbackRate ?? 1,
    });
  }, [onReel, miniPlayer, suspendMiniPlayerForReel, watchVideoRef]);

  if (!miniPlayer) return null;
  if (onReel) return null;

  return createPortal(<MiniPlayerContent />, document.body);
}
