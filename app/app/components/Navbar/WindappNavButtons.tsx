import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, RotateCw } from "lucide-react";
import { useLocation } from "react-router";
import { useWindapp } from "~/lib/hooks/useWindapp";
import { cn } from "~/lib/utils";

const navBtn =
  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-foreground/90 transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35";

/**
 * Back / forward / refresh — windapp only, sits in the navbar (or use as a cluster).
 */
export function WindappNavButtons({ className }: { className?: string }) {
  const isWindapp = useWindapp();
  const location = useLocation();
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);

  const refreshNavState = useCallback(() => {
    const api = window.memoriesWindapp;
    if (!api?.canGoBack || !api?.canGoForward) {
      setCanBack(window.history.length > 1);
      setCanForward(false);
      return;
    }
    void Promise.all([api.canGoBack(), api.canGoForward()]).then(([back, forward]) => {
      setCanBack(Boolean(back));
      setCanForward(Boolean(forward));
    });
  }, []);

  useEffect(() => {
    if (!isWindapp) return;
    refreshNavState();
  }, [isWindapp, location.pathname, location.search, location.hash, refreshNavState]);

  if (!isWindapp || !window.memoriesWindapp) return null;

  const api = window.memoriesWindapp;

  return (
    <div
      className={cn("windapp-no-drag flex shrink-0 items-center gap-0.5", className)}
      data-windapp-nav
    >
      <button
        type="button"
        className={navBtn}
        disabled={!canBack}
        aria-label="Go back"
        title="Back (Alt+←)"
        onClick={() => {
          void api.goBack?.().then(() => refreshNavState());
        }}
      >
        <ArrowLeft className="size-5" />
      </button>
      <button
        type="button"
        className={navBtn}
        disabled={!canForward}
        aria-label="Go forward"
        title="Forward (Alt+→)"
        onClick={() => {
          void api.goForward?.().then(() => refreshNavState());
        }}
      >
        <ArrowRight className="size-5" />
      </button>
      <button
        type="button"
        className={navBtn}
        aria-label="Refresh"
        title="Refresh"
        onClick={() => {
          void api.reload?.();
        }}
      >
        <RotateCw className="size-4" />
      </button>
    </div>
  );
}
