import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from "react";
import { createPortal, flushSync } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { motion } from "framer-motion";
import { useFileContext } from "~/lib/Context/Context";
import { fileAccentColors } from "~/components/components/hlsplayer/visualizerPalette";
import { Switch } from "~/components/ui/switch";
import { ListVideo, X, ChevronUp, ChevronDown, Play, Pause, SkipForward } from "lucide-react";
import { useMiniPlayerContext, isReelPath } from "~/lib/Context/MiniPlayerContext";
import { useWatchSurfaceVideoRef } from "~/lib/Context/WatchSurfaceVideoRefContext";
import { useMainPlayerSlot } from "~/lib/Context/MainPlayerSlotContext";
import { displayMediaTitle } from "~/lib/utils";
import { cn } from "~/lib/utils";
import { useMiniPlayerDrag, SNAP_TRANSITION_MS, SNAP_EASING } from "./useMiniPlayerDrag";
import { MINI_MOBILE_BAR_H_PX, MINI_MOBILE_SEEK_HIT_PX, MINI_MOBILE_SEEK_INSET_PX, useMiniMobileBar } from "./miniMobileBar";
import { setMiniPlayerMobileBarDragLock } from "./miniPlayerDragBridge";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import MiniPlayerQueue from "./MiniPlayerQueue";
import { useWatchPlayBootstrap } from "~/lib/Context/WatchPlayBootstrapContext";
import type { FileType } from "~/lib/types";

/**
 * Shared empty list for "this file has no series up-next".
 * Must be a single module level value: a fresh `[]` per render is a dependency
 * that never compares equal, which is what caused the mini player's render loop.
 */
const NO_SERIES: FileType[] = [];

const MINI_HEADER_H = 0;
const MINI_FOOTER_H = 56;
/** Auto-next row shown above the queue when expanded. */
const MINI_AUTO_NEXT_H = 56;
const MINI_QUEUE_HEADER_H = 30;
const MINI_QUEUE_ROW_H = 72;
const MINI_VIEWPORT_PAD = 16;
const MOBILE_BAR_H = MINI_MOBILE_BAR_H_PX;
/** How far the phone card floats above the tab bar. */
const MOBILE_BAR_GAP = 8;
/**
 * The docked player paints at 2147483645, between the card's controls (the
 * mini player's z) and this background, so its video shows on the card.
 */
const MOBILE_CARD_BG_Z = 2147483644;
/** 16:9 at 40px tall, where the docked video shows (see the player's miniSeekOnly frame). */
const MOBILE_THUMB_W = 72;
const MINI_AUTO_NEXT_KEY = "mini-auto-next";

function readMiniAutoNext(fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(MINI_AUTO_NEXT_KEY);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {
    /* ignore */
  }
  return fallback;
}

function writeMiniAutoNext(v: boolean) {
  try {
    localStorage.setItem(MINI_AUTO_NEXT_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function bottomReservedPx(): number {
  if (typeof window === "undefined") return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--app-bottom-nav-h");
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function filterMiniQueueItems(list: FileType[], currentUniqueId: string): FileType[] {
  return list.filter((f) => f && f.unique_id && f.unique_id !== currentUniqueId && !f.is_reel);
}

/** Owner label for mini chrome (nested owner or flat API fields). */
function miniOwnerName(file: FileType): string | null {
  const nested = file.owner?.username?.trim();
  if (nested) return nested;
  const flat = (file as { owner_username?: string | null }).owner_username?.trim();
  return flat || null;
}

/** Soft music-bar accent (file palette hex). */
function miniBarAccent(colors: unknown): string | undefined {
  return fileAccentColors(colors)[0];
}

function MiniPlayerContent() {
  const {
    miniPlayer,
    containerRef,
    setContainerReady,
    activateMiniPlayer,
    closeMiniPlayer,
    startExpand,
    isExpanding,
  } = useMiniPlayerContext();
  const { setMiniSlot } = useMainPlayerSlot();
  const watchVideoRef = useWatchSurfaceVideoRef();
  const navigate = useNavigate();
  const isMobileBar = useMiniMobileBar();
  const { playerSettings } = useFileContext();
  const globalAutoPlay = playerSettings?.autoPlay ?? false;
  const [miniAutoNext, setMiniAutoNextState] = useState(() => readMiniAutoNext(globalAutoPlay));
  const sessionKey = miniPlayer?.file.unique_id ?? "";

  const setMiniAutoNext = useCallback((v: boolean) => {
    setMiniAutoNextState(v);
    writeMiniAutoNext(v);
  }, []);
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
  } = useMiniPlayerDrag(sessionKey, !isMobileBar);
  const [closing, setClosing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const { queueData } = useWatchPlayBootstrap();
  // Stable reference on purpose. Writing `?? []` inline mints a fresh array
  // every render, and queueData is null whenever there is no watch context,
  // which is exactly the case when you navigate away with the mini player open.
  // As an effect dependency that array never compares equal, so the effect below
  // used to re-run forever and pin the main thread (React #185, and the reason
  // navigation felt dead rather than merely slow).
  const seriesUpNext = queueData?.seriesUpNextVideos ?? NO_SERIES;
  /** Only a series gives the mini player something to queue. */
  const hasQueue = seriesUpNext.length > 0;

  // Derived rather than mirrored into state. The currently playing file is
  // filtered out, so starting an item in the mini player drops it from up-next
  // on the next render with nobody having to clear the list by hand.
  const queueItems = useMemo(
    () => filterMiniQueueItems(seriesUpNext, String(miniPlayer?.file?.unique_id ?? "")),
    [seriesUpNext, miniPlayer?.file?.unique_id],
  );
  // Up-next is pushed down by the watch loader, so a fetch is never in flight.
  const queueLoading = false;
  const seedDbId = String(miniPlayer?.file.id ?? "");
  const mobileBarRef = useRef<HTMLDivElement | null>(null);

  /**
   * Up-next in the mini player comes from the SERIES episodes the watch loader
   * already provided — there is no client request here any more (the old
   * /api/related-videos call is gone, and /api/play-queue is unregistered).
   *
   * Consequence, and it is deliberate: when the file is NOT part of a series
   * there is nothing to queue, so the dropdown / collapse affordance is hidden
   * rather than opening onto an empty panel.
   */
  // No client fetch remains: up-next arrives with the watch loader payload.

  // There used to be an effect here that read a queue cache on seedDbId change.
  // Nothing ever wrote that cache once the fetch became a no-op, so it resolved
  // to setQueueItems([]) and, running after the effect that populated the list,
  // blanked series up-next every time the file changed. queueItems is derived
  // now, so both the cache and this effect are gone.

  useEffect(() => {
    setExpanded(false);
    setQueueOpen(false);
  }, [sessionKey]);

  // Prefer explicit localStorage choice; otherwise follow global autoplay when a session starts.
  useEffect(() => {
    try {
      if (localStorage.getItem(MINI_AUTO_NEXT_KEY) == null) {
        setMiniAutoNextState(globalAutoPlay);
      }
    } catch {
      setMiniAutoNextState(globalAutoPlay);
    }
  }, [sessionKey, globalAutoPlay]);

  // Mobile bar never drags; unlock when leaving bar mode (separate flag from VR).
  useEffect(() => {
    setMiniPlayerMobileBarDragLock(isMobileBar);
    return () => setMiniPlayerMobileBarDragLock(false);
  }, [isMobileBar]);

  // Publish bar height for toasts / floats stacked above nav + mini.
  useEffect(() => {
    const root = document.documentElement;
    if (!isMobileBar || !miniPlayer) {
      root.style.removeProperty("--app-mini-player-h");
      return;
    }
    const el = mobileBarRef.current;
    root.style.setProperty("--app-mini-player-h", `${(el?.offsetHeight ?? MOBILE_BAR_H) + MOBILE_BAR_GAP}px`);
    return () => {
      root.style.removeProperty("--app-mini-player-h");
    };
  }, [isMobileBar, miniPlayer, queueOpen]);

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
  const shellAspect = Math.min(Math.max(videoAspect ?? 16 / 9, 0.625), 2.4);

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

  const expandedChromeH = MINI_CHROME_H + MINI_AUTO_NEXT_H;
  /** Nearly full viewport — expanded queue always grows to this. */
  const fullPanelH = Math.max(
    280,
    viewportH - MINI_VIEWPORT_PAD * 2 - bottomReservedPx(),
  );

  const layoutW = displayWidth;
  const naturalVideoH = Math.min(layoutW / shellAspect, maxShellH);

  // Expanded = always fill viewport height (grow all the way up). Collapsed keeps natural size.
  const queueExpanded = !isMobileBar && expanded;
  let queueMaxH = 0;
  let videoH = Math.max(96, naturalVideoH);
  let shellLeft = position.x;
  let shellTop = position.y;
  const shellWidth = displayWidth;
  let layoutAvailableH = fullPanelH;

  if (queueExpanded) {
    layoutAvailableH = fullPanelH;
    const minQueue = 180;
    videoH = Math.max(
      140,
      Math.min(naturalVideoH, layoutAvailableH - expandedChromeH - minQueue),
    );
    queueMaxH = Math.max(minQueue, layoutAvailableH - expandedChromeH - videoH);
    shellLeft = Math.max(
      MINI_VIEWPORT_PAD,
      Math.min(position.x, viewportW - displayWidth - MINI_VIEWPORT_PAD),
    );
    // Pin to top padding so the panel runs full height down to the bottom reserve.
    shellTop = MINI_VIEWPORT_PAD;
  } else if (tuck === "none" && !isDragging && !isSnapping) {
    // Keep the floating shell fully on-screen. Skip while dragging (transform
    // owns the pose) AND while snapping — the drag hook just computed a settle
    // target from the element's MEASURED size; re-clamping it here with the
    // estimate below redirects the animation mid-flight (flash) or lets the
    // real box hang past the viewport when the estimate runs short.
    const measuredH = elementRef.current?.offsetHeight ?? 0;
    const shellH = Math.max(measuredH, videoH + MINI_CHROME_H);
    const maxLeft = Math.max(MINI_VIEWPORT_PAD, viewportW - shellWidth - MINI_VIEWPORT_PAD);
    const maxTop = Math.max(
      MINI_VIEWPORT_PAD,
      viewportH - shellH - MINI_VIEWPORT_PAD - bottomReservedPx(),
    );
    shellLeft = Math.min(maxLeft, Math.max(MINI_VIEWPORT_PAD, position.x));
    shellTop = Math.min(maxTop, Math.max(MINI_VIEWPORT_PAD, position.y));
  }

  const toggleQueue = useCallback(() => {
    // Full-height expand repositions via shellTop — never lock the top edge
    // (that was shrinking the video when the mini sat near the bottom).
    setLockTopAnchor(false);
    setExpanded((v) => !v);
  }, [setLockTopAnchor]);

  useEffect(() => {
    if (isMobileBar || !expanded) return;
    const t = window.setTimeout(() => clampIntoView(), 150);
    return () => window.clearTimeout(t);
  }, [isMobileBar, expanded, viewportH, viewportW, queueItems.length, queueLoading, clampIntoView]);

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
        // No manual clear needed: queueItems is derived and filters out the file
        // that is now playing.
        setExpanded(false);
        setQueueOpen(false);
      } finally {
        setQueueBusyId(null);
      }
    },
    [activateMiniPlayer, queueBusyId],
  );

  // Auto-next inside mini (no navigation) when the toggle is on.
  const handlePlayInMiniRef = useRef(handlePlayInMini);
  handlePlayInMiniRef.current = handlePlayInMini;
  const miniAutoNextRef = useRef(miniAutoNext);
  miniAutoNextRef.current = miniAutoNext;
  const queueItemsRef = useRef(queueItems);
  queueItemsRef.current = queueItems;

  useEffect(() => {
    if (!miniPlayer) return;
    const video = watchVideoRef.current;
    if (!video) return;

    // Up-next is already in hand from the loader, so there is no fetch fallback
    // to fall back to: an empty list simply means nothing follows this file.
    const onEnded = () => {
      if (!miniAutoNextRef.current) return;
      const next = queueItemsRef.current[0];
      if (next) void handlePlayInMiniRef.current(next);
    };

    video.addEventListener("ended", onEnded);
    return () => video.removeEventListener("ended", onEnded);
  }, [miniPlayer, watchVideoRef, sessionKey]);

  /**
   * Transport state for the mobile bar. The docked <video> stays the source of
   * truth — mirroring its events keeps the button honest when playback is
   * changed from anywhere else (autoplay, the OS media keys, the watch page).
   */
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (!miniPlayer) return;
    const video = watchVideoRef.current;
    if (!video) return;
    const sync = () => setIsPlaying(!video.paused && !video.ended);
    sync();
    for (const evt of ["play", "pause", "ended", "emptied"]) {
      video.addEventListener(evt, sync);
    }
    return () => {
      for (const evt of ["play", "pause", "ended", "emptied"]) {
        video.removeEventListener(evt, sync);
      }
    };
  }, [miniPlayer, watchVideoRef, sessionKey]);

  const toggleMiniPlay = useCallback(() => {
    const video = watchVideoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  }, [watchVideoRef]);

  const playNextInMini = useCallback(() => {
    const next = queueItemsRef.current[0];
    if (next) void handlePlayInMiniRef.current(next);
  }, []);

  const expandToWatch = useCallback(() => {
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
  }, [miniPlayer, isExpanding, watchVideoRef, startExpand, navigate]);

  const handleClose = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => closeMiniPlayer(), 180);
  }, [closeMiniPlayer]);

  if (!miniPlayer) return null;

  const title = displayMediaTitle(miniPlayer.file.file_title || miniPlayer.file.filename || "");
  const titleStr = typeof title === "string" ? title : (title as string[]).join("");
  const ownerName = miniOwnerName(miniPlayer.file);
  const barAccent = miniBarAccent((miniPlayer.file as { colors?: unknown }).colors);
  /** Desktop floating mini: solid tint (no translucent opacity). */
  const desktopSolidBg = barAccent
    ? `color-mix(in srgb, ${barAccent} 22%, var(--card))`
    : undefined;
  // ── Mobile mini player (≤700px): the app's floating card ──────────────
  if (isMobileBar) {
    const control =
      "pointer-events-auto relative z-20 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted active:bg-muted";
    const card = cn(
      "pointer-events-none fixed inset-x-2 mx-auto max-w-[640px] rounded-2xl transition-[opacity,transform] duration-200 animate-in fade-in-0 slide-in-from-bottom-2",
      closing && "translate-y-2 opacity-0",
    );
    const place = { bottom: `calc(var(--app-bottom-nav-h, 0px) + ${MOBILE_BAR_GAP}px)`, height: MOBILE_BAR_H };
    return (
      <>
        {/* Catches taps that miss the controls so they never reach the feed behind. */}
        <div
          aria-hidden
          className={cn(card, "pointer-events-auto border border-border bg-secondary/95 shadow-lg shadow-black/15 backdrop-blur-xl")}
          style={{ ...place, zIndex: MOBILE_CARD_BG_Z }}
        />
        <div
          ref={mobileBarRef}
          data-mini-player
          data-mini-mobile-bar=""
          // overflow-visible so the scrub preview can float above the card.
          className={cn(card, "z-[var(--z-mini-player)] overflow-visible")}
          style={place}
        >
          {/* The docked player fills the card: its video is the thumbnail and its seek rail the bottom line. */}
          <div
            ref={bindVideoShellRef}
            className={cn("absolute inset-0 overflow-visible bg-transparent", `mini_player_inner_${miniPlayer.imageID}`)}
          />

          <div className="relative z-10 flex h-full items-center pl-3 pr-1 pointer-events-none">
            {/* One tap catcher over the card opens the video and keeps taps from
                reaching the feed behind it. It stops short of the scrub band. */}
            <button
              type="button"
              aria-label="Open video"
              onClick={expandToWatch}
              className="pointer-events-auto absolute inset-x-0 top-0 z-0 rounded-t-2xl"
              style={{ bottom: MINI_MOBILE_SEEK_HIT_PX + MINI_MOBILE_SEEK_INSET_PX.bottom }}
            />

            <div aria-hidden className="pointer-events-none h-10 shrink-0" style={{ width: MOBILE_THUMB_W }} />

            <div className="pointer-events-none relative z-10 ml-2.5 mr-1 min-w-0 flex-1">
              <p className="truncate text-sm font-semibold leading-[18px] text-foreground">{titleStr}</p>
              {ownerName ? <p className="mt-px truncate text-xs leading-[15px] text-muted-foreground">{ownerName}</p> : null}
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleMiniPlay();
              }}
              className={control}
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause className="h-5 w-5" fill="currentColor" /> : <Play className="h-5 w-5" fill="currentColor" />}
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                playNextInMini();
              }}
              // At 375px four controls squeeze the title to a few characters; up next stays one tap away in the queue.
              className={cn(control, "max-[420px]:hidden", !hasQueue && "hidden")}
              aria-label="Play next"
            >
              <SkipForward className="h-[18px] w-[18px]" fill="currentColor" />
            </button>

            <Popover open={queueOpen} onOpenChange={setQueueOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className={cn(control, queueOpen && "bg-muted", !hasQueue && "hidden")}
                  aria-label="Up next"
                  aria-expanded={queueOpen}
                >
                  <ListVideo className="h-[18px] w-[18px]" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="end"
                sideOffset={10}
                className="w-[min(100vw-1.5rem,22rem)] max-h-[min(40vh,24rem)] overflow-hidden rounded-2xl p-0"
              >
                <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">Auto next</p>
                    <p className="text-[11px] text-muted-foreground">
                      Play the next video in mini without opening the page
                    </p>
                  </div>
                  <Switch
                    checked={miniAutoNext}
                    onCheckedChange={setMiniAutoNext}
                    aria-label="Auto next in mini player"
                  />
                </div>
                <MiniPlayerQueue
                  current={miniPlayer.file as FileType}
                  items={queueItems}
                  loading={queueLoading}
                  onPlay={handlePlayInMini}
                  busyId={queueBusyId}
                  maxHeight={Math.floor(viewportH * 0.4) - 72}
                />
              </PopoverContent>
            </Popover>

            <button
              type="button"
              className={control}
              aria-label="Close mini player"
              onClick={(e) => {
                e.stopPropagation();
                handleClose();
              }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </>
    );
  }

  // ── Desktop floating mini ──────────────────────────────────────────────
  return (
    <motion.div
      ref={elementRef}
      data-mini-player
      initial={false}
      animate={{ width: shellWidth }}
      transition={
        isDragging
          ? { duration: 0 }
          : { type: "tween", duration: isSnapping ? SNAP_TRANSITION_MS / 1000 : 0.15, ease: [0.22, 1, 0.36, 1] }
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
            ? `left ${SNAP_TRANSITION_MS}ms ${SNAP_EASING}, top ${SNAP_TRANSITION_MS}ms ${SNAP_EASING}, opacity ${SNAP_TRANSITION_MS}ms ${SNAP_EASING}`
            : mounted
              ? `left 220ms ${SNAP_EASING}, top 220ms ${SNAP_EASING}, opacity 200ms ease`
              : "none",
        willChange: isDragging || isSnapping ? "left, top" : "opacity, transform",
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
            "border border-border/40 bg-card/90 shadow-md",
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
            "border border-border/40 bg-card/90 shadow-md",
          )}
          style={{ isolation: "isolate" }}
          onPointerDown={handlePointerDown}
        />
      )}

      <div
        className={cn(
          "relative flex max-h-[inherit] cursor-grab select-none flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg active:cursor-grabbing",
          queueExpanded && "h-full",
        )}
        style={{
          maxHeight: queueExpanded ? layoutAvailableH : undefined,
          height: queueExpanded ? layoutAvailableH : undefined,
          backgroundColor: desktopSolidBg,
        }}
        aria-label="Drag to move mini player"
      >
        <div
          ref={bindVideoShellRef}
          className={cn(
            "relative z-0 w-full shrink-0 overflow-hidden rounded-t-xl bg-black",
            `mini_player_inner_${miniPlayer.imageID}`,
          )}
          style={{
            aspectRatio: String(shellAspect),
            width: "100%",
            height: videoH,
            maxHeight: videoH,
          }}
        />

        <div className="relative z-10 flex shrink-0 items-center gap-2 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-snug text-foreground">{titleStr}</p>
            {ownerName ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{ownerName}</p>
            ) : null}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-mini-no-drag
                onClick={(e) => {
                  e.stopPropagation();
                  toggleQueue();
                }}
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted/80",
                  !hasQueue && "hidden",
                )}
                aria-label={expanded ? "Hide up next" : "Show up next"}
                aria-expanded={expanded}
              >
                {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{expanded ? "Hide up next" : "Up next"}</TooltipContent>
          </Tooltip>
        </div>

        <div
          className={cn("relative z-10 min-h-0 flex-1", !expanded && "hidden")}
          data-mini-no-drag
        >
          <div className="flex items-center justify-between gap-3 border-t border-border/50 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Auto next</p>
              <p className="text-[11px] text-muted-foreground">Stay in mini when the video ends</p>
            </div>
            <Switch
              checked={miniAutoNext}
              onCheckedChange={setMiniAutoNext}
              aria-label="Auto next in mini player"
            />
          </div>
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
          data-mini-resize
          className="absolute bottom-1 right-1 z-20 h-4 w-4 cursor-nwse-resize touch-none rounded-sm opacity-50 hover:opacity-100"
          onPointerDown={(e) => {
            e.stopPropagation();
            handleResizePointerDown(e);
          }}
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
