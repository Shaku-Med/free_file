import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useNavigate } from "react-router";
import { DynamicHLSPlayerWithQueue } from "~/routes/Dynamic/components/DynamicHLSPlayerWithQueue";
import type { DynamicHLSPlayerWithQueueProps } from "~/routes/Dynamic/components/DynamicHLSPlayerWithQueue";
import { useMainPlayerSlot } from "~/lib/Context/MainPlayerSlotContext";
import { useMiniPlayerContext, type MiniPlayerState } from "~/lib/Context/MiniPlayerContext";
import { useWatchHlsSurface } from "~/lib/Context/WatchHlsSurfaceContext";
import { useWatchSurfaceVideoRef } from "~/lib/Context/WatchSurfaceVideoRefContext";
import { useGlobalPlayerLayoutContext } from "~/lib/Context/GlobalPlayerLayoutContext";
import { useFileContext } from "~/lib/Context/Context";
import { useAnchorBoundingRect } from "~/lib/hooks/useAnchorBoundingRect";
import { getVideoSrc, cn } from "~/lib/utils";
import type { FileType } from "~/lib/types";

const MAIN_ANCHOR_Z = 99_999_995;
/** One step above mini chrome (`z-[2147483646]`) so video paints on top of the slot, not behind it. */
const MINI_DOCK_Z = 2147483647;

function miniFallbackProps(
  mini: Pick<MiniPlayerState, "file" | "imageID">,
  videoRef: RefObject<HTMLVideoElement | null>,
  userId: string | null,
): DynamicHLSPlayerWithQueueProps {
  return {
    videoRef,
    /** Same URL computation as the watch page so `useHLS` never sees a spurious `src` change. */
    src: getVideoSrc(mini.file.endpoint ?? "", mini.file.file_type),
    className: "h-full w-full",
    playsInline: true,
    imageID: mini.imageID,
    file: mini.file,
    authPlaybackFeatures: Boolean(userId),
    guestWatchLimitSeconds: null,
    seriesEpisodeGroups: null,
    endScreenUserActions: undefined,
    currentUserId: userId || undefined,
    callBack: undefined,
    onAmbientModeChange: undefined,
    onVideoRef: undefined,
  };
}

/**
 * Single `DynamicHLSPlayerWithQueue` instance for watch + floating mini: portaled to
 * `player_inner_*` or `mini_player_inner_*`.
 */
export function GlobalAnchoredHLSPlayer() {
  const { setLayout } = useGlobalPlayerLayoutContext();
  const { state } = useMainPlayerSlot();
  const { miniPlayer } = useMiniPlayerContext();
  const { surface } = useWatchHlsSurface();
  const videoRef = useWatchSurfaceVideoRef();
  const { userId } = useFileContext();
  const navigate = useNavigate();

  /** Mini takes over only after the watch surface is cleared — same global player, new anchor. */
  const inMiniLayout = Boolean(miniPlayer && !surface?.props);
  const anchorEl = inMiniLayout ? state.miniAnchorEl : state.anchorEl;
  /** Theater + layoutId use transform animation; RO/scroll won't update — match parent every frame. */
  const syncPositionEachFrame =
    Boolean(inMiniLayout && state.miniAnchorEl) ||
    Boolean(surface?.props && state.anchorEl);
  // Imperative position updates — bypasses React's reconciler so scroll
  // and drag no longer re-render the entire portal'd player subtree on
  // every frame. The hook still hands us a state-backed rect for the
  // FIRST mount (so the portal renders), then routes subsequent updates
  // through onUpdate which we apply directly to the container's style.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onRectUpdate = useCallback((r: { top: number; left: number; width: number; height: number }) => {
    const el = containerRef.current;
    if (!el) return;
    // Update style directly. style writes are coalesced by the browser
    // and never trigger React work — this is the entire perf fix.
    el.style.top = `${r.top}px`;
    el.style.left = `${r.left}px`;
    el.style.width = `${r.width}px`;
    el.style.height = `${r.height}px`;
  }, []);
  const rawRect = useAnchorBoundingRect(anchorEl, {
    syncPositionEachFrame,
    onUpdate: onRectUpdate,
  });
  const lastGoodRectRef = useRef<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  if (rawRect && rawRect.width > 0 && rawRect.height > 0) {
    lastGoodRectRef.current = rawRect;
  }
  useLayoutEffect(() => {
    if (!miniPlayer && !surface?.props) {
      lastGoodRectRef.current = null;
    }
  }, [miniPlayer, surface?.props]);

  const rect =
    rawRect && rawRect.width > 0 && rawRect.height > 0
      ? rawRect
      : (miniPlayer || surface?.props) && lastGoodRectRef.current
        ? lastGoodRectRef.current
        : null;

  const miniNavigateSelect = useMemo(
    () => (video: FileType) => {
      navigate(`/${video.unique_id}`);
    },
    [navigate],
  );

  const resolved = useMemo(() => {
    if (surface?.props) {
      return {
        kind: "watch" as const,
        props: surface.props,
        theaterMode: surface.theaterMode,
        z: MAIN_ANCHOR_Z,
      };
    }
    if (miniPlayer && !surface?.props) {
      const p = miniFallbackProps(miniPlayer, videoRef, userId);
      return {
        kind: "mini" as const,
        props: {
          ...p,
          onVideoSelect: miniNavigateSelect,
        },
        theaterMode: false,
        z: MINI_DOCK_Z,
      };
    }
    return null;
  }, [surface, miniPlayer, videoRef, userId, miniNavigateSelect]);

  useLayoutEffect(() => {
    if (!resolved) {
      setLayout("idle");
      return;
    }
    if (resolved.kind === "watch") {
      setLayout("watch");
      return;
    }
    setLayout("mini");
  }, [resolved, setLayout]);

  /**
   * Defer commit of `resolved → null` by one rAF. If a new resolved arrives in the same
   * frame (route swap, mini handoff, expand transition), we never commit null → the React
   * subtree (and its `<video>` + Hls.js) stays mounted continuously. True "no player"
   * states (closeMiniPlayer, paused-leave-watch) still commit null on the next frame.
   */
  const [committedResolved, setCommittedResolved] = useState(resolved);
  const pendingNullRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (resolved) {
      if (pendingNullRef.current != null) {
        cancelAnimationFrame(pendingNullRef.current);
        pendingNullRef.current = null;
      }
      setCommittedResolved(resolved);
      return;
    }
    if (pendingNullRef.current != null) return;
    pendingNullRef.current = requestAnimationFrame(() => {
      pendingNullRef.current = null;
      setCommittedResolved(null);
    });
  }, [resolved]);
  useEffect(() => {
    return () => {
      if (pendingNullRef.current != null) {
        cancelAnimationFrame(pendingNullRef.current);
        pendingNullRef.current = null;
      }
    };
  }, []);

  if (typeof document === "undefined") return null;

  if (!committedResolved || !rect || rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  const { props, theaterMode, z } = committedResolved;

  return createPortal(
    <div
      ref={containerRef}
      className={cn(
        "pointer-events-auto overflow-hidden",
        theaterMode ? "bg-black" : "rounded-lg",
      )}
      style={{
        position: "fixed",
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        zIndex: z,
        // Promote to its own compositor layer — scroll won't repaint the
        // video texture, just re-position the layer. Cheap to keep on.
        willChange: "top, left, width, height",
      }}
    >
      <DynamicHLSPlayerWithQueue
        key="global-hls-docked-singleton"
        {...props}
        videoRef={videoRef as RefObject<HTMLVideoElement>}
      />
    </div>,
    document.body,
  );
}
