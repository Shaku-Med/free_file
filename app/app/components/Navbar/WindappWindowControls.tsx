import { Minus, Square, X } from "lucide-react";
import { isWindappMac, useWindapp } from "~/lib/hooks/useWindapp";

/**
 * Min / max / close — Windows & Linux windapp only.
 * Mac uses native traffic lights (close / minimize / zoom) from Electron.
 */
export function WindappWindowControls() {
  const isWindapp = useWindapp();
  const api = typeof window !== "undefined" ? window.memoriesWindapp : undefined;

  if (!api || (!isWindapp && !api.isDesktop)) return null;
  // MacBook / macOS: OS draws the red / yellow / green buttons top-left.
  if (isWindappMac() || api.platform === "darwin") return null;

  return (
    <div
      className="windapp-no-drag ml-1 flex shrink-0 items-center gap-0.5 border-l border-border/50 pl-1.5"
      data-windapp-window-controls
    >
      <button
        type="button"
        className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground/80 transition-colors hover:bg-muted/80 hover:text-foreground"
        onClick={() => void api.minimize?.()}
        aria-label="Minimize"
      >
        <Minus className="size-3.5" />
      </button>
      <button
        type="button"
        className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground/80 transition-colors hover:bg-muted/80 hover:text-foreground"
        onClick={() => void api.maximize?.()}
        aria-label="Maximize"
      >
        <Square className="size-3" />
      </button>
      <button
        type="button"
        className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground/80 transition-colors hover:bg-destructive/15 hover:text-destructive"
        onClick={() => void api.close?.()}
        aria-label="Close"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
