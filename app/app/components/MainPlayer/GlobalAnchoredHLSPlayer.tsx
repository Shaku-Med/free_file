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
import { isMiniHandoffPending, isPlayerAnchorLive } from "~/lib/hooks/playerAnchor";
import { cn } from "~/lib/utils";
import { usePlaybackUrl } from "~/lib/hooks/usePlaybackUrl";
import { resolvePlaybackSrc, playbackUrlMatchesFile } from "~/lib/playbackUrlCache";
import type { FileType } from "~/lib/types";

const MAIN_ANCHOR_Z = 99_999_995;
/** One step above mini chrome (`z-[2147483646]`) so video paints on top of the slot, not behind it. */
const MINI_DOCK_Z = 2147483647;

function miniFallbackProps(
  mini: MiniPlayerState,
  videoRef: RefObject<HTMLVideoElement | null>,
  userId: string | null,
  mintedUrl: string | null,
): DynamicHLSPlayerWithQueueProps {
  const restore = Boolean(mini.sessionRestore);
  return {
    videoRef,
    src: resolvePlaybackSrc(mini.file, { preferredSrc: mini.src, mintedUrl }),
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
    startTime: restore ? (mini.currentTime ?? 0) : undefined,
    autoPlay: restore ? (mini.wasPlaying ?? false) : undefined,
    muted: restore ? mini.muted : undefined,
  };
}

/**
 * Single `DynamicHLSPlayerWithQueue` instance for watch + floating mini: portaled to
 * `player_inner_*` or `mini_player_inner_*`.
 */
export function GlobalAnchoredHLSPlayer() {
  const { setLayout } = useGlobalPlayerLayoutContext();
  const { state } = useMainPlayerSlot();
  const { miniPlayer, clearMiniSessionRestore } = useMiniPlayerContext();
  const { surface } = useWatchHlsSurface();
  const videoRef = useWatchSurfaceVideoRef();
  const { userId, playerSettings } = useFileContext();
  const playerBackground = playerSettings?.playerBackground !== false;
  const navigate = useNavigate();
  // Mini-player gets its own JIT-minted, IP+UA-bound URL. The watch
  // surface already has one from Dynamic  when the surface clears and
  // mini takes over, this hook re-mints for the same file so playback
  // stays seamless without leaking a URL through HTML.
  const miniPlaybackUrl = usePlaybackUrl(
    miniPlayer && !surface?.props ? miniPlayer.file : null,
  );

  /** Keep one stable src string while the same video moves between watch + mini. */
  const stableSrcRef = useRef<{ fileId: string; src: string } | null>(null);

  const pickStableSrc = useCallback((fileId: string, nextSrc: string) => {
    if (nextSrc && fileId && !playbackUrlMatchesFile(nextSrc, fileId)) {
      nextSrc = "";
    }
    if (nextSrc) {
      stableSrcRef.current = { fileId, src: nextSrc };
      return nextSrc;
    }
    const prev = stableSrcRef.current;
    return prev?.fileId === fileId ? prev.src : nextSrc;
  }, []);

  const activeFileId =
    surface?.props?.file?.unique_id ??
    surface?.props?.imageID ??
    miniPlayer?.file.unique_id ??
    "";

  useLayoutEffect(() => {
    if (stableSrcRef.current && activeFileId && stableSrcRef.current.fileId !== activeFileId) {
      stableSrcRef.current = null;
    }
  }, [activeFileId]);

  /** Mini takes over only after the watch surface is cleared  same global player, new anchor. */
  const inMiniLayout = Boolean(miniPlayer && !surface?.props);
  const anchorEl = inMiniLayout ? state.miniAnchorEl : state.anchorEl;
  const anchorLive = isPlayerAnchorLive(anchorEl);
  const miniHandoffPending = isMiniHandoffPending(miniPlayer, Boolean(surface?.props), state.miniAnchorEl);
  /** Theater + layoutId use transform animation; RO/scroll won't update  match parent every frame. */
  const syncPositionEachFrame =
    anchorLive &&
    (Boolean(inMiniLayout && state.miniAnchorEl) ||
      Boolean(surface?.props && state.anchorEl));
  // Imperative position updates  bypasses React's reconciler so scroll
  // and drag no longer re-render the entire portal'd player subtree on
  // every frame. The hook still hands us a state-backed rect for the
  // FIRST mount (so the portal renders), then routes subsequent updates
  // through onUpdate which we apply directly to the container's style.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onRectUpdate = useCallback((r: { top: number; left: number; width: number; height: number }) => {
    const el = containerRef.current;
    if (!el) return;
    // Update style directly. style writes are coalesced by the browser
    // and never trigger React work  this is the entire perf fix.
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
  if (rawRect && rawRect.width > 0 && rawRect.height > 0 && anchorLive) {
    lastGoodRectRef.current = rawRect;
  }
  useLayoutEffect(() => {
    if (!miniPlayer && !surface?.props) {
      lastGoodRectRef.current = null;
      stableSrcRef.current = null;
    }
  }, [miniPlayer, surface?.props]);

  const canUseStickyRect = Boolean(
    anchorLive || (miniHandoffPending && lastGoodRectRef.current),
  );
  const rect =
    rawRect && rawRect.width > 0 && rawRect.height > 0
      ? rawRect
      : canUseStickyRect && lastGoodRectRef.current
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
      const fileId = surface.props.file?.unique_id ?? surface.props.imageID ?? "";
      const src = pickStableSrc(fileId, surface.props.src ?? "");
      return {
        kind: "watch" as const,
        props: { ...surface.props, src },
        theaterMode: surface.theaterMode,
        z: MAIN_ANCHOR_Z,
      };
    }
    if (miniPlayer && !surface?.props && userId) {
      const fileId = miniPlayer.file.unique_id;
      const p = miniFallbackProps(miniPlayer, videoRef, userId, miniPlaybackUrl);
      const src = pickStableSrc(fileId, p.src);
      return {
        kind: "mini" as const,
        props: {
          ...p,
          src,
          onVideoSelect: miniNavigateSelect,
        },
        theaterMode: false,
        z: MINI_DOCK_Z,
      };
    }
    return null;
  }, [surface, miniPlayer, videoRef, userId, miniNavigateSelect, miniPlaybackUrl, pickStableSrc]);

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
    // Mini handoff can clear the watch surface for a frame — keep the same React tree mounted.
    if (miniPlayer) return;
    if (pendingNullRef.current != null) return;
    pendingNullRef.current = requestAnimationFrame(() => {
      pendingNullRef.current = null;
      setCommittedResolved(null);
    });
  }, [resolved, miniPlayer]);
  useEffect(() => {
    if (!miniPlayer?.sessionRestore) return;
    const video = videoRef.current;
    if (!video) return;
    const clear = () => clearMiniSessionRestore();
    if (video.readyState >= 1 && video.duration > 0) {
      const id = requestAnimationFrame(clear);
      return () => cancelAnimationFrame(id);
    }
    video.addEventListener("loadedmetadata", clear, { once: true });
    return () => video.removeEventListener("loadedmetadata", clear);
  }, [miniPlayer?.sessionRestore, miniPlayer?.file.unique_id, clearMiniSessionRestore, videoRef]);
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
        theaterMode
          ? playerBackground
            ? "bg-black"
            : "bg-transparent"
          : "rounded-lg",
      )}
      style={{
        position: "fixed",
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        zIndex: z,
        // Promote to its own compositor layer  scroll won't repaint the
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
