import { useEffect, useState, useCallback } from "react";
import { flushSync } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X, Maximize2, Loader2 } from "lucide-react";
import { useMiniPlayerContext } from "~/lib/Context/MiniPlayerContext";
import { useMainPlayerSlot } from "~/lib/Context/MainPlayerSlotContext";
import { useWatchSurfaceVideoRef } from "~/lib/Context/WatchSurfaceVideoRefContext";
import { ParseFilename } from "~/lib/utils";
import { cn } from "~/lib/utils";
import { useMiniPlayerDrag } from "./useMiniPlayerDrag";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

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
      animate={{ width: frameWidth }}
      transition={
        isDragging ? { duration: 0 }
          : { type: "tween", duration: isSnapping ? 0.2 : 0.15, ease: "easeOut" }
      }
      className={cn(
        "fixed z-[2147483646] max-w-[calc(100vw-1.5rem)] overflow-visible",
        closing && "opacity-0 scale-95 translate-y-3",
        !closing && mounted && "opacity-100 scale-100 translate-y-0",
        !mounted && "opacity-0",
      )}
      style={{
        left: position.x,
        top: position.y,
        width: frameWidth,
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
          "relative aspect-video w-full overflow-hidden bg-black",
          `mini_player_inner_${miniPlayer.imageID}`,
        )}
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

/** Reel surface owns the global player while user is on `/reel*`  mini is closed, not just hidden. */
function isReelPath(pathname: string): boolean {
  const s = pathname.replace(/^\/+/, "");
  return s === "reel" || s.startsWith("reel/");
}

export default function MiniPlayer() {
  const { miniPlayer, closeMiniPlayer } = useMiniPlayerContext();
  const location = useLocation();
  const onReel = isReelPath(location.pathname);

  useEffect(() => {
    if (onReel && miniPlayer) closeMiniPlayer();
  }, [onReel, miniPlayer, closeMiniPlayer]);

  if (!miniPlayer) return null;
  if (onReel) return null;

  return createPortal(<MiniPlayerContent />, document.body);
}
