import { useEffect, useLayoutEffect, useState, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X, Maximize2, Loader2, ChevronUp, ChevronDown } from "lucide-react";
import { useMiniPlayerContext, isReelPath } from "~/lib/Context/MiniPlayerContext";
import { useWatchSurfaceVideoRef } from "~/lib/Context/WatchSurfaceVideoRefContext";
import { useMainPlayerSlot } from "~/lib/Context/MainPlayerSlotContext";
import { displayMediaTitle } from "~/lib/utils";
import { cn } from "~/lib/utils";
import { useMiniPlayerDrag } from "./useMiniPlayerDrag";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import Ambience from "~/components/accessories/CanvasGradient/Ambience";
import MiniPlayerQueue from "./MiniPlayerQueue";
import type { FileType } from "~/lib/types";

type QueueCacheEntry = { items: FileType[] };

const MINI_HEADER_H = 36;
const MINI_FOOTER_H = 52;
const MINI_QUEUE_HEADER_H = 30;
const MINI_QUEUE_ROW_H = 72;
const MINI_VIEWPORT_PAD = 12;
/** Below this viewport height, opening the queue fills the screen. */
const SHORT_VIEWPORT_H = 540;

function bottomReservedPx(): number {
  if (typeof window === "undefined") return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--app-bottom-nav-h");
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function filterMiniQueueItems(list: FileType[], currentUniqueId: string): FileType[] {
  return list.filter((f) => f && f.unique_id && f.unique_id !== currentUniqueId && !f.is_reel);
}

function MiniPlayerContent() {
  const {
    miniPlayer,
    closeMiniPlayer,
    containerRef,
    setContainerReady,
    isExpanding,
    startExpand,
    activateMiniPlayer,
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
    clampIntoView,
    setLockTopAnchor,
  } = useMiniPlayerDrag(sessionKey);
  const [closing, setClosing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const queueCacheRef = useRef<Map<string, QueueCacheEntry>>(new Map());
  const queueFetchGenRef = useRef(0);
  const [queueItems, setQueueItems] = useState<FileType[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const seedDbId = String(miniPlayer?.file.id ?? "");

  const loadMiniQueue = useCallback(async (fileDbId: string, uniqueId: string, force = false) => {
    if (!fileDbId) return;
    if (!force) {
      const cached = queueCacheRef.current.get(fileDbId);
      if (cached) {
        setQueueItems(cached.items);
        setQueueLoading(false);
        return;
      }
    }
    const gen = ++queueFetchGenRef.current;
    setQueueLoading(true);
    try {
      const params = new URLSearchParams({ fileId: fileDbId });
      const res = await fetch(`/api/related-videos?${params.toString()}`, { credentials: "include" });
      const json = res.ok ? ((await res.json().catch(() => null)) as { data?: FileType[] } | null) : null;
      if (gen !== queueFetchGenRef.current) return;
      const list = Array.isArray(json?.data) ? json.data : [];
      const items = filterMiniQueueItems(list, uniqueId);
      queueCacheRef.current.set(fileDbId, { items });
      setQueueItems(items);
    } catch {
      if (gen === queueFetchGenRef.current) {
        queueCacheRef.current.set(fileDbId, { items: [] });
        setQueueItems([]);
      }
    } finally {
      if (gen === queueFetchGenRef.current) setQueueLoading(false);
    }
  }, []);

  // Show cached rows immediately when the mini session changes.
  useEffect(() => {
    if (!seedDbId) {
      setQueueItems([]);
      setQueueLoading(false);
      return;
    }
    const cached = queueCacheRef.current.get(seedDbId);
    setQueueItems(cached?.items ?? []);
    setQueueLoading(false);
  }, [seedDbId]);

  // Fetch once the first time the caret opens for this video (cached after that).
  useEffect(() => {
    if (!expanded || !seedDbId || !miniPlayer) return;
    void loadMiniQueue(seedDbId, miniPlayer.file.unique_id);
  }, [expanded, seedDbId, miniPlayer, loadMiniQueue]);

  // Collapse the queue whenever a new mini session starts.
  useEffect(() => setExpanded(false), [sessionKey]);

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
  const MINI_CHROME_H = MINI_HEADER_H + MINI_FOOTER_H;
  const [viewportH, setViewportH] = useState<number>(() =>
    typeof window === "undefined" ? 800 : window.innerHeight,
  );
  const [viewportW, setViewportW] = useState<number>(() =>
    typeof window === "undefined" ? 390 : window.innerWidth,
  );
  useEffect(() => {
    const onResize = () => {
      setViewportH(window.innerHeight);
      setViewportW(window.innerWidth);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const maxShellH = Math.max(160, Math.floor(viewportH * 0.52) - MINI_CHROME_H);
  const displayWidth = Math.min(frameWidth, Math.max(180, Math.floor(maxShellH * shellAspect)));

  const estimatedQueueBody =
    MINI_QUEUE_HEADER_H +
    MINI_QUEUE_ROW_H +
    queueItems.length * MINI_QUEUE_ROW_H +
    (queueLoading ? 44 : queueItems.length === 0 ? 28 : 8);

  const collapsedVideoH = Math.min(displayWidth / shellAspect, maxShellH);
  const collapsedTotalH = MINI_CHROME_H + collapsedVideoH;
  const fullPanelH = Math.max(
    280,
    viewportH - MINI_VIEWPORT_PAD * 2 - bottomReservedPx(),
  );

  // Docked near the bottom (or short viewport): open queue → full HEIGHT, same WIDTH.
  const nearBottom =
    position.y + collapsedTotalH >= viewportH - bottomReservedPx() - MINI_VIEWPORT_PAD - 32;
  const queueFullHeight = expanded && (nearBottom || viewportH < SHORT_VIEWPORT_H);

  const growAvailableH = Math.max(
    180,
    viewportH - position.y - MINI_VIEWPORT_PAD - bottomReservedPx(),
  );

  const layoutW = displayWidth;
  const naturalVideoH = Math.min(layoutW / shellAspect, maxShellH);

  let queueMaxH = 0;
  let videoH = Math.max(96, Math.min(naturalVideoH, growAvailableH - MINI_CHROME_H));
  let shellLeft = position.x;
  let shellTop = position.y;
  const shellWidth = displayWidth;

  if (expanded) {
    if (queueFullHeight) {
      const layoutAvailableH = fullPanelH;
      videoH = Math.max(140, Math.min(naturalVideoH, Math.floor(fullPanelH * 0.42)));
      queueMaxH = Math.max(120, layoutAvailableH - MINI_CHROME_H - videoH);
      shellLeft = Math.max(
        MINI_VIEWPORT_PAD,
        Math.min(position.x, viewportW - displayWidth - MINI_VIEWPORT_PAD),
      );
      // Grow upward from the bottom edge — width unchanged.
      shellTop = viewportH - layoutAvailableH - MINI_VIEWPORT_PAD - bottomReservedPx();
    } else {
      const layoutAvailableH = growAvailableH;
      videoH = naturalVideoH;
      queueMaxH = Math.min(
        Math.max(120, estimatedQueueBody),
        Math.max(108, layoutAvailableH - MINI_CHROME_H - videoH),
      );
      if (queueMaxH < 100) {
        queueMaxH = Math.max(100, Math.floor(layoutAvailableH * 0.34));
        videoH = Math.max(120, layoutAvailableH - MINI_CHROME_H - queueMaxH);
      }
    }
  }

  const layoutAvailableH = expanded
    ? queueFullHeight
      ? fullPanelH
      : growAvailableH
    : growAvailableH;

  const toggleQueue = useCallback(() => {
    const opening = !expanded;
    const collapsedH = MINI_CHROME_H + Math.min(displayWidth / shellAspect, maxShellH);
    const atBottom =
      position.y + collapsedH >= viewportH - bottomReservedPx() - MINI_VIEWPORT_PAD - 32;
    const willFullHeight = opening && (atBottom || viewportH < SHORT_VIEWPORT_H);
    // Pin top only when growing downward in place (not full-height expand).
    setLockTopAnchor(opening && !willFullHeight);
    setExpanded((v) => !v);
    window.setTimeout(() => setLockTopAnchor(false), 450);
  }, [expanded, viewportH, displayWidth, shellAspect, maxShellH, position.y, setLockTopAnchor]);

  // Grow-down mode only: nudge up if the taller shell clips off-screen.
  useEffect(() => {
    if (!expanded || queueFullHeight) return;
    const t = window.setTimeout(() => clampIntoView(), 150);
    return () => window.clearTimeout(t);
  }, [expanded, queueFullHeight, viewportH, viewportW, queueItems.length, queueLoading, clampIntoView]);

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

  // Play a queue item IN the mini (no navigation). The playback URL is minted
  // server-side by /api/play/mint  same-origin + X-Requested-With + access
  // check + IP/UA/nonce binding  so the client never builds a URL and a
  // guessed id can't mint a file the viewer can't see. Swapping miniPlayer.file
  // makes GlobalAnchoredHLSPlayer re-mint + load it seamlessly.
  const [queueBusyId, setQueueBusyId] = useState<string | null>(null);
  const handlePlayInMini = useCallback(
    async (f: FileType) => {
      const uid = f.unique_id;
      if (!uid || queueBusyId) return;
      setQueueBusyId(uid);
      try {
        const res = await fetch("/api/play/mint", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
          body: JSON.stringify({ fileId: uid }),
        });
        const body = res.ok ? ((await res.json().catch(() => null)) as { url?: string } | null) : null;
        const src = body?.url;
        if (!src) return;
        activateMiniPlayer({ src, file: f, imageID: uid });
        // Fresh up-next for the newly playing video next time the caret opens.
        queueCacheRef.current.delete(String(f.id ?? ""));
        setQueueItems([]);
        setExpanded(false);
      } finally {
        setQueueBusyId(null);
      }
    },
    [activateMiniPlayer, queueBusyId],
  );

  if (!miniPlayer) return null;

  const title = displayMediaTitle(miniPlayer.file.file_title || miniPlayer.file.filename || "");
  const titleStr = typeof title === "string" ? title : (title as string[]).join("");

  return (
    <motion.div
      ref={elementRef}
      data-mini-player
      initial={false}
      animate={{ width: shellWidth }}
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
        left: shellLeft,
        top: shellTop,
        width: shellWidth,
        isolation: "isolate",
        transition: isDragging
          ? "none"
          : isSnapping
            ? "left 200ms ease-out, top 200ms ease-out, opacity 200ms ease, transform 200ms ease"
            : mounted
              ? "left 180ms ease-out, top 180ms ease-out, opacity 200ms ease, transform 200ms ease"
              : "none",
        willChange: isDragging ? ("left, top") : ("opacity, transform"),
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
      {ambientOn && !tuck && !closing && !expanded && (
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-[14%] -z-[1] rounded-[2.5rem] opacity-75 blur-2xl saturate-150"
        >
          <Ambience key={sessionKey} colors={[]} videoRef={watchVideoRef} videoReady sync={false} />
        </div>
      )}

      <div
        className={cn(
          "flex max-h-[inherit] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg",
          queueFullHeight && expanded && "h-full",
        )}
        style={{ maxHeight: expanded ? layoutAvailableH : undefined }}
      >
        <div
          className="flex h-9 cursor-grab touch-none select-none items-center border-b border-border/50 bg-card px-1.5 active:cursor-grabbing"
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
                    ? "cursor-wait text-muted-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted/80",
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
          <div className="h-[3px] w-8 rounded-full bg-border" />
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
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted/80 touch-manipulation"
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
          "relative w-full shrink-0 overflow-hidden bg-black",
          `mini_player_inner_${miniPlayer.imageID}`,
        )}
        style={{
          aspectRatio: String(shellAspect),
          width: "100%",
          height: videoH,
          maxHeight: videoH,
        }}
      />

      <div className="flex shrink-0 items-center gap-1.5 border-t border-border/50 bg-card px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium leading-snug text-foreground">{titleStr}</p>
          {miniPlayer.file.owner?.username && (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{miniPlayer.file.owner.username}</p>
          )}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                toggleQueue();
              }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted/80"
              aria-label={expanded ? "Hide up next" : "Show up next"}
              aria-expanded={expanded}
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{expanded ? "Hide up next" : "Up next"}</TooltipContent>
        </Tooltip>
      </div>

      <div className={cn(!expanded && "hidden")}>
        <MiniPlayerQueue
          current={miniPlayer.file as FileType}
          items={queueItems}
          loading={queueLoading}
          onPlay={handlePlayInMini}
          busyId={queueBusyId}
          maxHeight={queueMaxH}
        />
      </div>

      <div
        className="absolute bottom-10 right-2 z-20 h-5 w-5 cursor-nwse-resize touch-none rounded-md border border-border bg-card shadow-sm hover:bg-muted"
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
