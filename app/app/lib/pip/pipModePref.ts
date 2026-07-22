import { useEffect, useState } from "react";

/**
 * Per-device Picture-in-Picture style preference.
 *
 * - "phone"  (default) our compact portrait PiP window (Document PiP on web,
 *            floating window in the desktop app). Looks like a phone screen.
 * - "wide"   on web, the browser's own native PiP (the "normal" small floating
 *            video). In the desktop app this will open a landscape window
 *            (that variant ships separately).
 *
 * Client-only (localStorage) because PiP behaviour is a device UI preference,
 * not account data  no DB column, no sync. Mirrors the uiFloatPrefs pattern.
 * Never applied on mobile: touch devices always use the platform default.
 */
export type PipMode = "phone" | "wide";

export const PIP_MODE_KEY = "ui-pip-mode";
export const PIP_MODE_EVENT = "ui-pip-mode-changed";

export function readPipMode(): PipMode {
  try {
    return localStorage.getItem(PIP_MODE_KEY) === "wide" ? "wide" : "phone";
  } catch {
    return "phone";
  }
}

export function writePipMode(mode: PipMode): void {
  try {
    localStorage.setItem(PIP_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PIP_MODE_EVENT, { detail: { mode } }));
  }
}

/** Live preference for the settings toggle. */
export function usePipMode(): [PipMode, (mode: PipMode) => void] {
  const [mode, setMode] = useState<PipMode>(() =>
    typeof window !== "undefined" ? readPipMode() : "phone",
  );
  useEffect(() => {
    setMode(readPipMode());
    const sync = () => setMode(readPipMode());
    window.addEventListener(PIP_MODE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PIP_MODE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const set = (next: PipMode) => {
    writePipMode(next);
    setMode(next);
  };
  return [mode, set];
}
