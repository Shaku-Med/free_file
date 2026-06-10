import { ArrowUp } from "lucide-react";
import { cn } from "~/lib/utils";

/**
 * Floating "scroll to top" control for the main feed. Visibility is driven by the
 * parent's existing scroll handler so we don't attach a second scroll listener.
 * Docks above the mobile tab bar via the published --app-bottom-nav-h var.
 */
export default function BackToTop({
  visible,
  onClick,
}: {
  visible: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Back to top"
      tabIndex={visible ? 0 : -1}
      className={cn(
        "fixed right-4 bottom-[calc(var(--app-bottom-nav-h,0px)+1rem)] z-40",
        "inline-flex h-11 w-11 items-center justify-center rounded-full",
        "border border-border/60 bg-background/90 text-foreground shadow-lg backdrop-blur-md",
        "supports-[backdrop-filter]:bg-background/70",
        "transition-all duration-200 ease-out hover:bg-muted active:scale-95",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        visible ? "opacity-100 translate-y-0" : "pointer-events-none translate-y-3 opacity-0",
      )}
    >
      <ArrowUp className="h-5 w-5" strokeWidth={2.2} />
    </button>
  );
}
