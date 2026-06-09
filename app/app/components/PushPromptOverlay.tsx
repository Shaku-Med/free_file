/**
 * PushPromptOverlay.tsx
 *
 * Shown ONCE per session for a signed-in user when:
 *   - The browser supports Web Push
 *   - Notification.permission is "default" (never been asked)
 *   - The user is not already subscribed
 *   - The user hasn't dismissed this prompt before
 *
 * Triggering the browser's native permission dialog from inside an
 * overlay (in response to a user click) is the modern best practice 
 * Chrome and Firefox both penalise sites that call `requestPermission`
 * out of the blue on page load. The overlay gives the user context
 * before the OS-level prompt appears.
 *
 * Dismissal is remembered in `localStorage` so we don't nag  the user
 * can still flip notifications on later from Settings.
 */

import { useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { usePushNotifications } from "~/lib/hooks/usePushNotifications";
import { useFileContext } from "~/lib/Context/Context";

const DISMISS_KEY = "memories.pushPrompt.dismissedAt";
/** Re-show the prompt at most once every 14 days if the user dismissed
 *  it last time. Long enough not to feel nagged, short enough that
 *  they get a second chance if they later realise they want pushes. */
const REPROMPT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
/** Delay before first showing the prompt after sign-in. Gives the rest
 *  of the page time to render so we're not the first thing they see. */
const SHOW_AFTER_MS = 4_000;

function getDismissedAt(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function recordDismiss() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* private mode  ignore */
  }
}

export default function PushPromptOverlay() {
  const { userId } = useFileContext();
  const push = usePushNotifications();
  const [open, setOpen] = useState(false);

  // Decide whether to show. Runs whenever a relevant signal changes.
  // Conditions are AND'd together; any failure means we stay quiet.
  useEffect(() => {
    if (!userId) return;                          // need to be signed in
    if (!push.supported) return;                  // SW + PushManager + Notification
    if (push.permission !== "default") return;    // already granted or denied
    if (push.isSubscribed) return;                // already on
    if (Date.now() - getDismissedAt() < REPROMPT_WINDOW_MS) return;

    // Delay so the overlay isn't the first thing on screen at sign-in.
    const t = window.setTimeout(() => setOpen(true), SHOW_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [userId, push.supported, push.permission, push.isSubscribed]);

  // If the user grants / denies in Settings (or another tab) while the
  // overlay is open, close it automatically.
  useEffect(() => {
    if (!open) return;
    if (push.permission !== "default" || push.isSubscribed) {
      setOpen(false);
    }
  }, [open, push.permission, push.isSubscribed]);

  if (!open) return null;

  const handleEnable = async () => {
    const ok = await push.subscribe();
    if (ok) setOpen(false);
    // On failure (denied / dismissed at the OS prompt) keep the overlay
    // open so the error message is visible. The user can still close.
  };

  const handleDismiss = () => {
    recordDismiss();
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="push-prompt-title"
      aria-describedby="push-prompt-desc"
      // Bottom-anchored card on mobile (matches OS toast patterns),
      // floating bottom-right on desktop. Pointer events stay scoped
      // to the card so the rest of the app stays interactive.
      className="pointer-events-none fixed inset-x-0 bottom-[var(--app-bottom-nav-h,0px)] z-[60] flex justify-center p-3 sm:inset-auto sm:bottom-4 sm:right-4 sm:p-0"
    >
      <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-border bg-card shadow-xl ring-1 ring-black/5 backdrop-blur-sm sm:w-[22rem]">
        <div className="relative flex gap-3 p-4">
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss"
            className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <BellRing className="h-5 w-5" />
          </div>

          <div className="min-w-0 flex-1 pr-6">
            <p
              id="push-prompt-title"
              className="text-sm font-semibold text-foreground"
            >
              Turn on notifications?
            </p>
            <p id="push-prompt-desc" className="mt-1 text-xs text-muted-foreground">
              Get a ping when someone replies, likes, or subscribes  only
              when you're not on the site. You can change this anytime
              in Settings.
            </p>
            {push.error && (
              <p className="mt-2 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                {push.error}
              </p>
            )}
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDismiss}
                disabled={push.loading}
              >
                Not now
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleEnable}
                disabled={push.loading}
              >
                {push.loading ? "Enabling…" : "Turn on"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
