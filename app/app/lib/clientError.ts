import { toast } from "~/components/ui/sonner";

// Tiny client-side error reporter. In production, posts to the server so the
// crash lands in error_logs with a ref code the user can quote. In dev, skips
// the network entirely (devs see the real error in the console).
//
// Always shows a persistent toast. Clicking the toast's "Details" action
// dispatches a window event that the global ErrorDetailsDialog listens for.

export const ERROR_DETAILS_EVENT = "memories:error-details";

function isDev(): boolean {
  if (typeof window === "undefined") return false;
  // Vite / React Router dev server.
  if (typeof import.meta !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    return true;
  }
  // Fallback: hostname check.
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
}

async function postClientError(input: {
  message: string;
  stack?: string;
  url?: string;
  component?: string;
}): Promise<string | null> {
  if (isDev()) return null; // see console for the real error
  try {
    const res = await fetch("/api/internal/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ref?: string };
    return typeof data.ref === "string" ? data.ref : null;
  } catch {
    return null;
  }
}

interface ShowOptions {
  /** Short, human title. Defaults to "Something hiccuped". */
  title?: string;
  /** Pre-existing ref code (e.g. from a server response). Skips the network post. */
  ref?: string;
  /** Extra optional message body. */
  message?: string;
  /** Underlying error (Error or unknown). Stack used in the server report. */
  error?: unknown;
  /** Component/feature label (e.g. "upload modal"), included in the report context. */
  source?: string;
}

/** Fire-and-forget. Shows a persistent toast; in prod also logs to the server. */
export async function reportClientError(options: ShowOptions = {}): Promise<string | null> {
  const err = options.error;
  const message =
    options.message ??
    (err instanceof Error ? err.message : typeof err === "string" ? err : "client error");
  const stack = err instanceof Error ? err.stack : undefined;

  let ref = options.ref ?? null;
  if (!ref) {
    ref = await postClientError({
      message,
      stack,
      url: typeof window !== "undefined" ? window.location.href : undefined,
      component: options.source,
    });
  }

  showErrorToast({ title: options.title, ref: ref ?? undefined });
  return ref;
}

/** Shows the persistent error toast without making any network calls. */
export function showErrorToast(opts: { title?: string; ref?: string } = {}) {
  const title = opts.title ?? "Something hiccuped";
  const ref = opts.ref;
  toast.error(title, {
    duration: Infinity,
    description: ref ? `Code: ${ref}` : "Tap for details.",
    action: {
      label: "Details",
      onClick: () => {
        if (typeof window === "undefined") return;
        window.dispatchEvent(new CustomEvent(ERROR_DETAILS_EVENT, { detail: { ref } }));
      },
    },
  });
}
