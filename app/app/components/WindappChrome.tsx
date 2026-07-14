import { useEffect } from "react";
import { useWindapp } from "~/lib/hooks/useWindapp";

/**
 * Windapp root chrome: document class + keyboard navigation shortcuts.
 * Window controls / nav buttons live in the Navbar.
 */
export function WindappChrome() {
  const isWindapp = useWindapp();

  useEffect(() => {
    if (!isWindapp) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const api = window.memoriesWindapp;
      if (!api) return;

      // Don't steal shortcuts from inputs
      const t = event.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        return;
      }

      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          void api.goBack?.();
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          void api.goForward?.();
        }
      }

      if ((event.ctrlKey || event.metaKey) && (event.key === "r" || event.key === "R")) {
        // Let Ctrl+R refresh via Electron; prevent double-handling if needed
        if (api.reload) {
          event.preventDefault();
          void api.reload();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isWindapp]);

  return null;
}
