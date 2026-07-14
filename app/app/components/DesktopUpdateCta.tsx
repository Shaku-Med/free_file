import { ArrowUpCircle, X } from "lucide-react";
import { useShowDesktopUpdateCta, useDesktopUpdate } from "~/lib/hooks/useDesktopUpdate";
import { cn } from "~/lib/utils";

/**
 * Sticky upgrade affordances for windapp when a newer desktop build is published.
 * Header: compact pill. Sidebar: sticky CTA above the account footer.
 */
export function DesktopUpdateHeaderButton({ className }: { className?: string }) {
  const show = useShowDesktopUpdateCta();
  const { latest, installing, startUpdate } = useDesktopUpdate();
  if (!show) return null;

  return (
    <button
      type="button"
      onClick={() => void startUpdate()}
      disabled={installing}
      className={cn(
        "windapp-no-drag inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-70",
        className,
      )}
      aria-label={latest ? `Update to Memories ${latest}` : "Update Memories"}
      title={latest ? `Update to ${latest}` : "Update available"}
    >
      <ArrowUpCircle className="h-3.5 w-3.5" aria-hidden />
      <span>{installing ? "Updating…" : "Update"}</span>
    </button>
  );
}

export function DesktopUpdateSidebarCard() {
  const show = useShowDesktopUpdateCta();
  const { latest, current, installing, startUpdate, dismiss } = useDesktopUpdate();
  if (!show) return null;

  return (
    <div className="windapp-no-drag sticky bottom-0 z-10 border-t border-border/40 bg-background/95 p-2 backdrop-blur-sm group-data-[collapsible=icon]:p-1.5">
      <div className="relative rounded-xl border border-primary/25 bg-primary/5 p-2.5 group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0">
        <button
          type="button"
          onClick={dismiss}
          className="absolute right-1.5 top-1.5 rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground group-data-[collapsible=icon]:hidden"
          aria-label="Dismiss update notice"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <div className="pr-5 group-data-[collapsible=icon]:hidden">
          <p className="text-xs font-semibold text-foreground">Update available</p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {latest && current
              ? `${current} → ${latest}`
              : latest
                ? `Version ${latest} is ready`
                : "A newer Memories build is ready"}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void startUpdate()}
          disabled={installing}
          className={cn(
            "mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-70",
            "group-data-[collapsible=icon]:mt-0 group-data-[collapsible=icon]:h-9 group-data-[collapsible=icon]:w-9 group-data-[collapsible=icon]:rounded-md group-data-[collapsible=icon]:p-0",
          )}
          aria-label={latest ? `Update to Memories ${latest}` : "Update Memories"}
          title={latest ? `Update to ${latest}` : "Update"}
        >
          <ArrowUpCircle className="h-3.5 w-3.5" aria-hidden />
          <span className="group-data-[collapsible=icon]:hidden">
            {installing ? "Updating…" : "Upgrade now"}
          </span>
        </button>
      </div>
    </div>
  );
}
