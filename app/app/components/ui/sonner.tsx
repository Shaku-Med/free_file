import { Toaster as SonnerToaster, type ToasterProps } from "sonner";
import { platformOf, useDeviceStyle } from "~/lib/device";
import { cn } from "~/lib/utils";
import { useDeviceClass } from "./device";

// shadcn-style sonner wrapper. Theme tokens follow the rest of the app.
export function Toaster(props: ToasterProps) {
  const platform = platformOf(useDeviceStyle());
  const device = useDeviceClass("toast");
  return (
    <SonnerToaster
      // iOS drops banners from the top; Android's snackbars rise from the bottom.
      position={platform === "ios" ? "top-center" : platform === "material" ? "bottom-center" : "bottom-right"}
      richColors
      closeButton
      // Lift toasts above the mobile tab bar (var is 0 when the bar isn't shown).
      offset={{ bottom: "calc(var(--app-bottom-nav-h, 0px) + 24px)" }}
      mobileOffset={{ bottom: "calc(var(--app-bottom-nav-h, 0px) + 16px)" }}
      toastOptions={{
        classNames: {
          toast: cn(
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
            device,
          ),
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}

// Re-export the imperative API so callers don't import sonner directly.
export { toast } from "sonner";
