import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { FileType } from "~/lib/types";

export type WatchPlayBootstrap = {
  currentUniqueId: string;
  fileId?: string;
  viewerCanCustomizeQueue: boolean;
  /** The current file is a picture  up-next is disabled for it. */
  currentIsImage?: boolean;
  /**
   * Up-next content, supplied by the WATCH LOADER — there is no client fetch.
   * Series episodes when the file is part of a series, otherwise a few similar
   * videos prefetched on the server.
   */
  seriesUpNextVideos?: FileType[];
  suggestedVideos?: FileType[];
  userActions?: { likedFileIds: string[]; dislikedFileIds: string[] };
};

export type PlayQueuePayload = {
  seriesUpNextVideos: FileType[];
  suggestedVideos: FileType[];
  userActions: { likedFileIds: string[]; dislikedFileIds: string[] };
};

type Ctx = {
  bootstrap: WatchPlayBootstrap | null;
  setBootstrap: (b: WatchPlayBootstrap | null) => void;
  queueData: PlayQueuePayload | null;
  queueLoading: boolean;
  queueFetchKey: number;
  refreshQueue: () => void;
};

const WatchPlayBootstrapContext = createContext<Ctx | null>(null);

export function WatchPlayBootstrapProvider({ children }: { children: ReactNode }) {
  const [bootstrap, setBootstrapState] = useState<WatchPlayBootstrap | null>(null);
  const queueLoading = false;
  const [queueFetchKey, setQueueFetchKey] = useState(0);

  const setBootstrap = useCallback((b: WatchPlayBootstrap | null) => {
    setBootstrapState(b);
  }, []);

  /**
   * Kept for API compatibility; there is nothing to refetch now that up-next
   * arrives with the loader.
   */
  const refreshQueue = useCallback(() => {
    setQueueFetchKey((k) => k + 1);
  }, []);

  /**
   * Up-next is DERIVED from the loader payload rather than fetched.
   *
   * This used to hit /api/play-queue on every watch navigation, which meant a
   * spinner and a round trip for data the server could have sent with the page.
   * That endpoint is now unregistered and the client makes no queue request at
   * all.
   */
  const queueData = useMemo<PlayQueuePayload | null>(() => {
    if (!bootstrap?.currentUniqueId || bootstrap.currentUniqueId === "__none__") {
      return null;
    }
    return {
      seriesUpNextVideos: bootstrap.seriesUpNextVideos ?? [],
      suggestedVideos: bootstrap.suggestedVideos ?? [],
      userActions: {
        likedFileIds: bootstrap.userActions?.likedFileIds ?? [],
        dislikedFileIds: bootstrap.userActions?.dislikedFileIds ?? [],
      },
    };
  }, [bootstrap]);

  const value = useMemo(
    () => ({
      bootstrap,
      setBootstrap,
      queueData,
      queueLoading,
      queueFetchKey,
      refreshQueue,
    }),
    [bootstrap, setBootstrap, queueData, queueLoading, queueFetchKey, refreshQueue]
  );

  return (
    <WatchPlayBootstrapContext.Provider value={value}>
      {children}
    </WatchPlayBootstrapContext.Provider>
  );
}

export function useWatchPlayBootstrap(): Ctx {
  const ctx = useContext(WatchPlayBootstrapContext);
  if (!ctx) {
    throw new Error("useWatchPlayBootstrap must be used within WatchPlayBootstrapProvider");
  }
  return ctx;
}
