import { createContext, useCallback, useContext, useEffect, useState } from "react";

type ReelFullscreen = { active: boolean; toggle: () => void };

const ReelFullscreenContext = createContext<ReelFullscreen | null>(null);

export const ReelFullscreenProvider = ReelFullscreenContext.Provider;

/** The reel page's full screen, or null outside it (a reel shown anywhere else has no such mode). */
export function useReelFullscreen() {
  return useContext(ReelFullscreenContext);
}

/**
 * Full screen for the reel page, like YouTube Shorts: the browser goes full
 * screen and the header and sidebar step aside so the reel has the whole
 * page. Where the browser can't go full screen (an iPhone) the page still
 * drops its chrome. Escape, the browser's own exit, or leaving the page ends it.
 */
export function useReelFullscreenState(): ReelFullscreen {
  const [active, setActive] = useState(false);

  const toggle = useCallback(() => {
    if (active) {
      setActive(false);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
      return;
    }
    setActive(true);
    document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, [active]);

  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setActive(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      window.removeEventListener("keydown", onKey);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (active) root.dataset.reelFullscreen = "";
    else delete root.dataset.reelFullscreen;
    return () => {
      delete root.dataset.reelFullscreen;
    };
  }, [active]);

  return { active, toggle };
}
