import { Toaster as SonnerToaster, type ToasterProps } from "sonner";

// shadcn-style sonner wrapper. Theme tokens follow the rest of the app.
export function Toaster(props: ToasterProps) {
  return (
    <SonnerToaster
      position="bottom-right"
      richColors
      closeButton
      // Lift toasts above the mobile tab bar (var is 0 when the bar isn't shown).
      offset={{ bottom: "calc(var(--app-bottom-nav-h, 0px) + 24px)" }}
      mobileOffset={{ bottom: "calc(var(--app-bottom-nav-h, 0px) + 16px)" }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
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
