import {
  createContext,
  useContext,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from "react";

const WatchSurfaceVideoRefContext =
  createContext<MutableRefObject<HTMLVideoElement | null> | null>(null);

/** One `<video>` ref for the global watch / mini anchored player. */
export function WatchSurfaceVideoRefProvider({ children }: { children: ReactNode }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  return (
    <WatchSurfaceVideoRefContext.Provider value={videoRef}>
      {children}
    </WatchSurfaceVideoRefContext.Provider>
  );
}

export function useWatchSurfaceVideoRef(): MutableRefObject<HTMLVideoElement | null> {
  const ctx = useContext(WatchSurfaceVideoRefContext);
  if (!ctx) {
    throw new Error(
      "useWatchSurfaceVideoRef must be used within WatchSurfaceVideoRefProvider",
    );
  }
  return ctx;
}
