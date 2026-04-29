import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { FileType } from "~/lib/types";

export type WatchPlayBootstrap = {
  currentUniqueId: string;
  seriesUpNextVideos: FileType[];
  suggestedVideos: FileType[];
  viewerCanCustomizeQueue: boolean;
};

type Ctx = {
  bootstrap: WatchPlayBootstrap | null;
  setBootstrap: (b: WatchPlayBootstrap | null) => void;
};

const WatchPlayBootstrapContext = createContext<Ctx | null>(null);

export function WatchPlayBootstrapProvider({ children }: { children: ReactNode }) {
  const [bootstrap, setBootstrapState] = useState<WatchPlayBootstrap | null>(null);
  const setBootstrap = useCallback((b: WatchPlayBootstrap | null) => {
    setBootstrapState(b);
  }, []);
  const value = useMemo(() => ({ bootstrap, setBootstrap }), [bootstrap, setBootstrap]);
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
