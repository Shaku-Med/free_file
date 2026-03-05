import { useEffect, useState } from "react";

/**
 * Detects when the app is running as an installed PWA / standalone (e.g. launched
 * from home screen on mobile). Use this to adjust layout for the status bar
 * (e.g. padding-top: env(safe-area-inset-top) on the header).
 *
 * Checks:
 * - display-mode: standalone (standard PWA)
 * - display-mode: fullscreen
 * - display-mode: minimal-ui
 * - navigator.standalone (legacy iOS Safari)
 */
export function useStandalone(): boolean {
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const check = (): boolean => {
      if (typeof window === "undefined") return false;
      // Standard: PWA launched from home screen
      if (window.matchMedia("(display-mode: standalone)").matches) return true;
      if (window.matchMedia("(display-mode: fullscreen)").matches) return true;
      if (window.matchMedia("(display-mode: minimal-ui)").matches) return true;
      // Legacy iOS Safari (add to home screen)
      if ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true) return true;
      return false;
    };

    setIsStandalone(check());

    const mql = window.matchMedia("(display-mode: standalone)");
    const listener = () => setIsStandalone(check());
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }, []);

  return isStandalone;
}