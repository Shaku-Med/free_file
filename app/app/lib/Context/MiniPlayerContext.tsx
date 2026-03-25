import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { useLocation } from 'react-router';
import type { FileType } from '~/lib/types';

export interface MiniPlayerState {
  src: string;
  file: FileType;
  currentTime: number;
  imageID: string;
  /** Was the video playing when mini player was activated? */
  wasPlaying: boolean;
  volume: number;
  muted: boolean;
  playbackRate: number;
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
  'logout', 'settings', 'notifications', 'profile', 'reel',
]);

function isDynamicVideoPath(pathname: string): boolean {
  const segment = pathname.replace(/^\//, '').split('/')[0] ?? '';
  if (!segment) return false; // "/" is not dynamic
  return !STATIC_TOP_SEGMENTS.has(segment);
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
  signalMainPlayerReady: () => void;
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
    setMiniPlayer(state);
    setIsPortalMode(false);
    setPendingNavigateTo(options?.navigateTo ?? null);
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

  const signalMainPlayerReady = useCallback(() => {
    if (!isExpanding) return;
    setMiniPlayer(null);
    setIsPortalMode(false);
    setContainerReady(false);
    setIsExpanding(false);
    setExpandPlaybackState(null);
    sourceVideoRef.current = null;
  }, [isExpanding]);

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
        signalMainPlayerReady,
        expandPlaybackState,
        sourceVideoRef,
      }}
    >
      {children}
    </MiniPlayerContext.Provider>
  );
}
