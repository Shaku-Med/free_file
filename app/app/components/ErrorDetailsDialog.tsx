import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { ERROR_DETAILS_EVENT } from "~/lib/clientError";

// Listens for the global "error-details" event fired by the error toast and
// renders a small dialog with the support code. Brief by design  no stack
// traces, no raw error messages.
export function ErrorDetailsDialog() {
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function handle(e: Event) {
      const detail = (e as CustomEvent<{ ref?: string | null }>).detail;
      setRef(detail?.ref ?? null);
      setCopied(false);
      setOpen(true);
    }
    window.addEventListener(ERROR_DETAILS_EVENT, handle as EventListener);
    return () => window.removeEventListener(ERROR_DETAILS_EVENT, handle as EventListener);
  }, []);

  async function copyRef() {
    if (!ref) return;
    try {
      await navigator.clipboard.writeText(ref);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore  user can still read it on screen */
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Something went wrong</DialogTitle>
          <DialogDescription className="sr-only">Error details</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>We hit a snag on our end. Refreshing usually fixes it.</p>
          {ref ? (
            <div className="rounded-md bg-muted px-3 py-2">
              <p className="text-xs text-muted-foreground">If you report this, mention</p>
              <p className="mt-0.5 font-mono text-sm font-semibold text-foreground">{ref}</p>
            </div>
          ) : (
            <p className="text-xs">No code captured for this one.</p>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          {ref && (
            <Button variant="outline" size="sm" onClick={copyRef}>
              {copied ? "Copied" : "Copy code"}
            </Button>
          )}
          <Button size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ErrorDetailsDialog;
