import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { useLocation } from 'react-router';
import type { FileType } from '~/lib/types';
import { setCachedPlaybackUrl } from '~/lib/playbackUrlCache';
import { useFileContext } from '~/lib/Context/Context';

export interface MiniPlayerState {
  src: string;
  file: FileType;
  imageID: string;
  /**
   * Optional metadata when activating a *second* player instance.
   * With the global player, playback continues on the same `<video>`  these are unused for props.
   */
  currentTime?: number;
  wasPlaying?: boolean;
  volume?: number;
  muted?: boolean;
  playbackRate?: number;
  /** Global `<video>` was torn down; seek/autoplay from snapshot on next mount (reel suspend resume). */
  sessionRestore?: boolean;
}

export interface ActivateMiniPlayerOptions {
  /** Path to navigate to once the mini player video is ready */
  navigateTo?: string;
}

/** Playback state snapshot from the mini player, used when expanding back to main player */
export interface ExpandPlaybackState {
  fileId: string;
  currentTime: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  wasPlaying: boolean;
}

const STATIC_TOP_SEGMENTS = new Set([
  'privacy', 'terms', 'api', 'playlist', 'tag', 'search', 'features', 'auth',
  'logout', 'settings', 'notifications', 'profile', 'reel', 'pip', 'subscriptions',
]);

export function isDynamicVideoPath(pathname: string): boolean {
  const segment = pathname.replace(/^\//, '').split('/')[0] ?? '';
  if (!segment) return false; // "/" is not dynamic
  return !STATIC_TOP_SEGMENTS.has(segment);
}

/** First path segment when the URL is a dynamic watch-style route (UUID, etc.). */
export function getDynamicVideoIdFromPath(pathname: string): string | null {
  const segment = pathname.replace(/^\//, '').split('/')[0] ?? '';
  if (!segment || STATIC_TOP_SEGMENTS.has(segment)) return null;
  return segment;
}

/** True when pathname is a single-segment in-app watch URL (`/:id`), excluding static routes. */
export function isSingleSegmentWatchPath(pathname: string): boolean {
  const s = pathname.replace(/^\/+|\/+$/g, "");
  if (!s || s.includes("/")) return false;
  return !STATIC_TOP_SEGMENTS.has(s);
}

export function isReelPath(pathname: string): boolean {
  const s = pathname.replace(/^\/+/, "");
  return s === "reel" || s.startsWith("reel/");
}

interface MiniPlayerContextType {
  miniPlayer: MiniPlayerState | null;
  isPortalMode: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  containerReady: boolean;
  setContainerReady: (ready: boolean) => void;
  activateMiniPlayer: (state: MiniPlayerState, options?: ActivateMiniPlayerOptions) => void;
  /** Hide mini on `/reel*` while preserving state for restore on non-watch exit. */
  suspendMiniPlayerForReel: (snapshot: MiniPlayerState) => void;
  /** Re-show mini after leaving reel to a page that is not a watch URL. */
  resumeSuspendedMiniPlayer: () => boolean;
  clearSuspendedMiniForReel: () => void;
  /** Clears one-shot reel resume seek/autoplay after the player has mounted. */
  clearMiniSessionRestore: () => void;
  closeMiniPlayer: () => void;
  updateMiniPlayerTime: (time: number) => void;
  getNavigateBackTarget: () => string;
  pendingNavigateTo: string | null;
  clearPendingNavigate: () => void;
  isExpanding: boolean;
  startExpand: (playbackState: ExpandPlaybackState) => void;
  /** Hide the mini player shell after the watch page slot has taken over (keeps expand handoff state until applied). */
  dismissMiniPlayerChrome: () => void;
  /** Clears expand/loader state after volume/playback prefs from mini are applied to the main `<video>`. */
  clearExpandHandoff: () => void;
  /** Playback state to hand off to the main player when expanding. Null if not expanding or IDs don't match. */
  expandPlaybackState: ExpandPlaybackState | null;
  /** Ref to the source (large) video element  set before activating so mini player can mute it once ready */
  sourceVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
}

const MiniPlayerContext = createContext<MiniPlayerContextType | undefined>(undefined);

export function useMiniPlayerContext() {
  const ctx = useContext(MiniPlayerContext);
  if (!ctx) throw new Error('useMiniPlayerContext must be used within MiniPlayerProvider');
  return ctx;
}

export function MiniPlayerProvider({ children }: { children: React.ReactNode }) {
  const { userId } = useFileContext();
  const [miniPlayer, setMiniPlayer] = useState<MiniPlayerState | null>(null);
  const [isPortalMode, setIsPortalMode] = useState(false);
  const [containerReady, setContainerReady] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sourceVideoRef = useRef<HTMLVideoElement | null>(null);
  const suspendedForReelRef = useRef<MiniPlayerState | null>(null);

  // Track navigation history for mini player back navigation
  const location = useLocation();
  const navigationHistoryRef = useRef<string[]>([]);

  useEffect(() => {
    const history = navigationHistoryRef.current;
    const pathname = location.pathname;
    if (history[history.length - 1] !== pathname) {
      history.push(pathname);
      if (history.length > 50) history.splice(0, history.length - 50);
    }
  }, [location.pathname]);

  const getNavigateBackTarget = useCallback((): string => {
    const history = navigationHistoryRef.current;
    for (let i = history.length - 2; i >= 0; i--) {
      const path = history[i];
      if (!isDynamicVideoPath(path)) {
        return path;
      }
    }
    return '/';
  }, []);

  const [pendingNavigateTo, setPendingNavigateTo] = useState<string | null>(null);

  const clearPendingNavigate = useCallback(() => {
    setPendingNavigateTo(null);
  }, []);

  const activateMiniPlayer = useCallback((state: MiniPlayerState, options?: ActivateMiniPlayerOptions) => {
    if (!userId) return;
    if (state.src && state.file.unique_id) {
      setCachedPlaybackUrl(state.file.unique_id, state.src);
    }
    setMiniPlayer(state);
    setIsPortalMode(false);
    setPendingNavigateTo(options?.navigateTo ?? null);
    setIsExpanding(false);
    setExpandPlaybackState(null);
  }, [userId]);

  const [isExpanding, setIsExpanding] = useState(false);
  const [expandPlaybackState, setExpandPlaybackState] = useState<ExpandPlaybackState | null>(null);

  const clearSuspendedMiniForReel = useCallback(() => {
    suspendedForReelRef.current = null;
  }, []);

  const suspendMiniPlayerForReel = useCallback((snapshot: MiniPlayerState) => {
    if (snapshot.src && snapshot.file.unique_id) {
      setCachedPlaybackUrl(snapshot.file.unique_id, snapshot.src);
    }
    suspendedForReelRef.current = { ...snapshot, sessionRestore: true };
    setMiniPlayer(null);
    setIsPortalMode(false);
    setContainerReady(false);
    sourceVideoRef.current = null;
  }, []);

  const resumeSuspendedMiniPlayer = useCallback((): boolean => {
    const snap = suspendedForReelRef.current;
    if (!snap) return false;
    suspendedForReelRef.current = null;
    if (snap.src && snap.file.unique_id) {
      setCachedPlaybackUrl(snap.file.unique_id, snap.src);
    }
    setMiniPlayer(snap);
    setIsPortalMode(false);
    setPendingNavigateTo(null);
    setIsExpanding(false);
    setExpandPlaybackState(null);
    return true;
  }, []);

  const clearMiniSessionRestore = useCallback(() => {
    setMiniPlayer(prev => {
      if (!prev?.sessionRestore) return prev;
      const { sessionRestore: _restore, ...rest } = prev;
      return rest;
    });
  }, []);

  const closeMiniPlayer = useCallback(() => {
    suspendedForReelRef.current = null;
    setMiniPlayer(null);
    setIsPortalMode(false);
    setContainerReady(false);
    setIsExpanding(false);
    setExpandPlaybackState(null);
    sourceVideoRef.current = null;
  }, []);

  useEffect(() => {
    if (!userId) closeMiniPlayer();
  }, [userId, closeMiniPlayer]);

  const startExpand = useCallback((playbackState: ExpandPlaybackState) => {
    setIsExpanding(true);
    setExpandPlaybackState(playbackState);
  }, []);

  const dismissMiniPlayerChrome = useCallback(() => {
    setMiniPlayer(null);
    setIsPortalMode(false);
    setContainerReady(false);
    sourceVideoRef.current = null;
  }, []);

  const clearExpandHandoff = useCallback(() => {
    setIsExpanding(false);
    setExpandPlaybackState(null);
  }, []);

  const updateMiniPlayerTime = useCallback((time: number) => {
    setMiniPlayer(prev => prev ? { ...prev, currentTime: time } : null);
  }, []);

  return (
    <MiniPlayerContext.Provider
      value={{
        miniPlayer,
        isPortalMode,
        containerRef,
        containerReady,
        setContainerReady,
        activateMiniPlayer,
        suspendMiniPlayerForReel,
        resumeSuspendedMiniPlayer,
        clearSuspendedMiniForReel,
        clearMiniSessionRestore,
        closeMiniPlayer,
        updateMiniPlayerTime,
        getNavigateBackTarget,
        pendingNavigateTo,
        clearPendingNavigate,
        isExpanding,
        startExpand,
        dismissMiniPlayerChrome,
        clearExpandHandoff,
        expandPlaybackState,
        sourceVideoRef,
      }}
    >
      {children}
    </MiniPlayerContext.Provider>
  );
}
