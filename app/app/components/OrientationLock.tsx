import { useEffect } from "react";
import { useStandalone } from "~/lib/hooks/useStandalone";

// `lock`/`unlock` aren't in the bundled DOM lib types but exist at runtime on Chromium.
type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: "portrait" | "landscape") => Promise<void>;
  unlock?: () => void;
};

/**
 * Locks installed (standalone) PWAs to portrait, but unlocks while a video is in
 * fullscreen so the player/reels can still rotate to landscape.
 *
 * Coverage:
 * - Android / Chromium installs: enforced here AND via the manifest `orientation`.
 * - iOS: the Screen Orientation lock API is unsupported and the manifest
 *   orientation is ignored, so this is a safe no-op there (Apple limitation).
 */
export default function OrientationLock() {
  const standalone = useStandalone();

  useEffect(() => {
    if (!standalone || typeof window === "undefined") return;
    const orientation = window.screen?.orientation as LockableOrientation | undefined;
    if (!orientation || typeof orientation.lock !== "function") return;

    const lockPortrait = () => {
      // rejected when unsupported / not allowed  ignore
      void orientation.lock?.("portrait")?.catch(() => {});
    };
    const onFullscreenChange = () => {
      if (document.fullscreenElement) {
        try { orientation.unlock?.(); } catch { /* ignore */ }
      } else {
        lockPortrait();
      }
    };

    lockPortrait();
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
      try { orientation.unlock?.(); } catch { /* ignore */ }
    };
  }, [standalone]);

  return null;
}
