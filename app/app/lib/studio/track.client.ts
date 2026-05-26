// Buffered studio analytics beacon. Flushes on 10 events, every 5s, or page hide.

export type StudioEventType =
  | "video_view"
  | "video_complete"
  | "profile_view"
  | "share"
  | "save"
  | "search_query";

export interface StudioEvent {
  type: StudioEventType;
  fileId?: string;
  ownerId?: string;
  metadata?: Record<string, string | number | boolean>;
}

const FLUSH_AT_COUNT = 10;
const FLUSH_INTERVAL_MS = 5000;
const ENDPOINT = "/api/studio/track";

let buffer: StudioEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let unloadBound = false;

function flushNow(useBeacon: boolean) {
  if (buffer.length === 0) return;
  const events = buffer;
  buffer = [];
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const body = JSON.stringify({ events });

  if (useBeacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    try {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon(ENDPOINT, blob);
      return;
    } catch {
      /* fall through */
    }
  }
  try {
    void fetch(ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flushNow(false);
  }, FLUSH_INTERVAL_MS);
}

function bindUnload() {
  if (unloadBound || typeof window === "undefined") return;
  unloadBound = true;
  const onLeave = () => flushNow(true);
  window.addEventListener("pagehide", onLeave);
  window.addEventListener("beforeunload", onLeave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushNow(true);
  });
}

export function trackStudioEvent(event: StudioEvent) {
  if (typeof window === "undefined") return;
  bindUnload();
  buffer.push(event);
  if (buffer.length >= FLUSH_AT_COUNT) {
    flushNow(false);
    return;
  }
  scheduleFlush();
}
