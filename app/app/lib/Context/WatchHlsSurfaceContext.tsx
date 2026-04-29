import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { WatchPageHlsSurfacePayload } from "~/components/MainPlayer/globalHlsSurfaceTypes";

type Ctx = {
  surface: WatchPageHlsSurfacePayload;
  setSurface: (p: WatchPageHlsSurfacePayload) => void;
};

const WatchHlsSurfaceContext = createContext<Ctx | null>(null);

export function WatchHlsSurfaceProvider({ children }: { children: ReactNode }) {
  const [surface, setSurfaceState] = useState<WatchPageHlsSurfacePayload>(null);
  const setSurface = useCallback((p: WatchPageHlsSurfacePayload) => {
    setSurfaceState(p);
  }, []);
  const value = useMemo(() => ({ surface, setSurface }), [surface, setSurface]);
  return (
    <WatchHlsSurfaceContext.Provider value={value}>{children}</WatchHlsSurfaceContext.Provider>
  );
}

export function useWatchHlsSurface(): Ctx {
  const ctx = useContext(WatchHlsSurfaceContext);
  if (!ctx) {
    throw new Error("useWatchHlsSurface must be used within WatchHlsSurfaceProvider");
  }
  return ctx;
}
