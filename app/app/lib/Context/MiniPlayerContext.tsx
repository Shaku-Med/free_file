import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { useLocation } from 'react-router';
import type { FileType } from '~/lib/types';
import { setCachedPlaybackUrl } from '~/lib/playbackUrlCache';

export interface MiniPlayerState {
  src: string;
  file: FileType;
  imageID: string;
  /**
   * Optional metadata when activating a *second* player instance.
   * With the global player, playback continues on the same `<video>` — these are unused for props.
   */
  currentTime?: number;
  wasPlaying?: boolean;
  volume?: number;
  muted?: boolean;
  playbackRate?: number;
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

interface MiniPlayerContextType {
  miniPlayer: MiniPlayerState | null;
  isPortalMode: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  containerReady: boolean;
  setContainerReady: (ready: boolean) => void;
  activateMiniPlayer: (state: MiniPlayerState, options?: ActivateMiniPlayerOptions) => void;
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
  /** Ref to the source (large) video element — set before activating so mini player can mute it once ready */
  sourceVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
}

const MiniPlayerContext = createContext<MiniPlayerContextType | undefined>(undefined);

export function useMiniPlayerContext() {
  const ctx = useContext(MiniPlayerContext);
  if (!ctx) throw new Error('useMiniPlayerContext must be used within MiniPlayerProvider');
  return ctx;
}

export function MiniPlayerProvider({ children }: { children: React.ReactNode }) {
  const [miniPlayer, setMiniPlayer] = useState<MiniPlayerState | null>(null);
  const [isPortalMode, setIsPortalMode] = useState(false);
  const [containerReady, setContainerReady] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sourceVideoRef = useRef<HTMLVideoElement | null>(null);

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
    if (state.src && state.file.unique_id) {
      setCachedPlaybackUrl(state.file.unique_id, state.src);
    }
    setMiniPlayer(state);
    setIsPortalMode(false);
    setPendingNavigateTo(options?.navigateTo ?? null);
    setIsExpanding(false);
    setExpandPlaybackState(null);
  }, []);

  const [isExpanding, setIsExpanding] = useState(false);
  const [expandPlaybackState, setExpandPlaybackState] = useState<ExpandPlaybackState | null>(null);

  const closeMiniPlayer = useCallback(() => {
    setMiniPlayer(null);
    setIsPortalMode(false);
    setContainerReady(false);
    setIsExpanding(false);
    setExpandPlaybackState(null);
    sourceVideoRef.current = null;
  }, []);

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
