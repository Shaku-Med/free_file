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
import { personalizationService } from "~/lib/Services/PersonalizationService";

export type WatchPlayBootstrap = {
  currentUniqueId: string;
  fileId?: string;
  viewerCanCustomizeQueue: boolean;
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

const EMPTY_QUEUE: PlayQueuePayload = {
  seriesUpNextVideos: [],
  suggestedVideos: [],
  userActions: { likedFileIds: [], dislikedFileIds: [] },
};

export function WatchPlayBootstrapProvider({ children }: { children: ReactNode }) {
  const [bootstrap, setBootstrapState] = useState<WatchPlayBootstrap | null>(null);
  const [queueData, setQueueData] = useState<PlayQueuePayload | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueFetchKey, setQueueFetchKey] = useState(0);
  const fetchGenRef = useRef(0);

  const setBootstrap = useCallback((b: WatchPlayBootstrap | null) => {
    setBootstrapState(b);
  }, []);

  const refreshQueue = useCallback(() => {
    setQueueFetchKey((k) => k + 1);
  }, []);

  useEffect(() => {
    const uid = bootstrap?.currentUniqueId;
    if (!uid || uid === "__none__") {
      setQueueData(null);
      setQueueLoading(false);
      return;
    }

    const gen = ++fetchGenRef.current;
    const ac = new AbortController();
    setQueueLoading(true);

    const params = new URLSearchParams({ unique_id: uid });
    if (bootstrap.fileId) params.set("fileId", bootstrap.fileId);
    const sCats = personalizationService.getSessionCategories();
    if (sCats.length > 0) params.set("session_cats", JSON.stringify(sCats));

    fetch(`/api/play-queue?${params}`, { credentials: "include", signal: ac.signal })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as {
          seriesUpNext?: FileType[];
          suggested?: FileType[];
          userActions?: { likedFileIds?: string[]; dislikedFileIds?: string[] };
        };
        if (ac.signal.aborted || gen !== fetchGenRef.current) return;
        if (!r.ok) {
          setQueueData(EMPTY_QUEUE);
          return;
        }
        setQueueData({
          seriesUpNextVideos: Array.isArray(j.seriesUpNext) ? j.seriesUpNext : [],
          suggestedVideos: Array.isArray(j.suggested) ? j.suggested : [],
          userActions: {
            likedFileIds: j.userActions?.likedFileIds ?? [],
            dislikedFileIds: j.userActions?.dislikedFileIds ?? [],
          },
        });
      })
      .catch(() => {
        if (!ac.signal.aborted && gen === fetchGenRef.current) {
          setQueueData(EMPTY_QUEUE);
        }
      })
      .finally(() => {
        if (!ac.signal.aborted && gen === fetchGenRef.current) {
          setQueueLoading(false);
        }
      });

    return () => ac.abort();
  }, [bootstrap?.currentUniqueId, bootstrap?.fileId, queueFetchKey]);

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
