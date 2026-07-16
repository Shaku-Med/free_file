import { useEffect, useState } from "react";

/** localStorage mirror of `users.snap_floats_to_corners` for live drag settle. */
export const SNAP_FLOATS_KEY = "ui-snap-floats-to-corners";
export const UI_FLOAT_PREFS_EVENT = "ui-float-prefs-changed";

export function readSnapFloatsToCorners(): boolean {
  try {
    return localStorage.getItem(SNAP_FLOATS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist locally and notify open drag surfaces (mini player, upload float). */
export function writeSnapFloatsToCorners(on: boolean) {
  try {
    localStorage.setItem(SNAP_FLOATS_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(UI_FLOAT_PREFS_EVENT, { detail: { snapFloatsToCorners: on } }),
    );
  }
}

/** Live preference for drag settle hooks. */
export function useSnapFloatsToCorners(): boolean {
  const [on, setOn] = useState(() =>
    typeof window !== "undefined" ? readSnapFloatsToCorners() : false,
  );
  useEffect(() => {
    setOn(readSnapFloatsToCorners());
    const sync = () => setOn(readSnapFloatsToCorners());
    window.addEventListener(UI_FLOAT_PREFS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(UI_FLOAT_PREFS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return on;
}
