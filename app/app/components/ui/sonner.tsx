import type { CSSProperties } from "react";
import { Toaster as SonnerToaster, type ToasterProps } from "sonner";
import { platformOf, useDeviceStyle } from "~/lib/device";
import { cn } from "~/lib/utils";
import { useDeviceClass } from "./device";

/**
 * Toasts in the app's own colours: the card surface with a coloured icon,
 * not Sonner's rich colours (a bright green slab that matched nothing here).
 * On a phone they rise from the bottom, clear of the tab bar and mini player,
 * instead of dropping over the page's header.
 */
export function Toaster(props: ToasterProps) {
  const platform = platformOf(useDeviceStyle());
  const device = useDeviceClass("toast");
  return (
    <SonnerToaster
      className="toaster group"
      // Sonner's own surface follows its light or dark setting, not the app's theme, so point it at ours.
      style={
        {
          "--normal-bg": "var(--card)",
          "--normal-text": "var(--card-foreground)",
          "--normal-border": "var(--border)",
        } as CSSProperties
      }
      position={platform ? "bottom-center" : "bottom-right"}
      closeButton
      gap={8}
      // Above the tab bar and the mini player (both vars are 0 when not shown).
      offset={{ bottom: "calc(var(--app-bottom-nav-h, 0px) + var(--app-mini-player-h, 0px) + 24px)" }}
      mobileOffset={{
        bottom: "calc(var(--app-bottom-nav-h, 0px) + var(--app-mini-player-h, 0px) + 12px)",
        left: "12px",
        right: "12px",
      }}
      toastOptions={{
        classNames: {
          toast: cn(
            "group toast items-start gap-3 rounded-2xl px-4 py-3 group-[.toaster]:border-border group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:shadow-lg group-[.toaster]:shadow-black/15",
            device,
          ),
          title: "text-sm font-semibold leading-5",
          description: "group-[.toast]:text-muted-foreground text-[13px] leading-[18px]",
          icon: "mt-0.5",
          success: "[&_[data-icon]]:text-primary",
          error: "[&_[data-icon]]:text-destructive",
          warning: "[&_[data-icon]]:text-primary",
          info: "[&_[data-icon]]:text-muted-foreground",
          closeButton:
            "group-[.toaster]:border-border group-[.toaster]:bg-card group-[.toaster]:text-muted-foreground hover:group-[.toaster]:bg-muted",
          actionButton: "group-[.toast]:rounded-full group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:rounded-full group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}

// Re-export the imperative API so callers don't import sonner directly.
export { toast } from "sonner";
