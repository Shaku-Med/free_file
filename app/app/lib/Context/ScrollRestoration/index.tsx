import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router";
import { useFileContext } from "~/lib/Context/Context";

const STORAGE_KEY = "scroll_restoration_data";
/** Fallback if rAF never runs; restoreLoop already waits for layout/content height. */
const RESTORE_FALLBACK_MS = 250;

interface ScrollData {
  scrollTop: number;
  scrollLeft: number;
}
type Store = Record<string, ScrollData>;

/** One scroll slot per logical page (path + query — not hash, so in-page #anchors don't reset the shell). */
function routeScrollKey(pathname: string, search: string): string {
  return `${pathname}${search}`;
}

const getContainer = (): HTMLElement | null =>
  document.getElementById("scroll_container");

const readStore = (): Store => {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
};
const writeEntry = (path: string, d: ScrollData) => {
  try {
    const s = readStore();
    s[path] = d;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* quota / private mode */
  }
};
const readEntry = (path: string): ScrollData | null =>
  readStore()[path] ?? null;

type RestoreState = "idle" | "pending" | "restoring";

export default function ScrollRestoration() {
  const location = useLocation();
  const { setScrollDataReady } = useFileContext();

  // 'idle'      → user-driven scroll, persist freely
  // 'pending'   → just navigated, awaiting restore (do NOT persist; user scroll cancels)
  // 'restoring' → actively running rAF loop (do NOT persist)
  const stateRef = useRef<RestoreState>("idle");
  const routeKeyRef = useRef<string>("");
  // Bumped on every navigation; in-flight rAF loops bail if their token is stale.
  const tokenRef = useRef(0);

  // Pre-paint: save the OLD path's scroll, reset to top for the NEW path, decide
  // whether we should attempt to restore. Runs synchronously after DOM commit but
  // before paint, so there's no flash of the previous page's scroll.
  useLayoutEffect(() => {
    const container = getContainer();
    if (!container) return;
    const newKey = routeScrollKey(location.pathname, location.search);
    const oldKey = routeKeyRef.current;

    // Persist outgoing scroll only if the user owned it (state was idle).
    // If state was pending/restoring, the user never settled, so don't overwrite
    // whatever was there before.
    if (oldKey && oldKey !== newKey && stateRef.current === "idle") {
      writeEntry(oldKey, {
        scrollTop: container.scrollTop,
        scrollLeft: container.scrollLeft,
      });
    }

    routeKeyRef.current = newKey;
    tokenRef.current++;

    // Reset before paint so the new page never appears at the previous scroll.
    container.scrollTop = 0;
    container.scrollLeft = 0;

    const canRestore = Boolean(readEntry(newKey));
    setScrollDataReady(!canRestore);
    stateRef.current = canRestore ? "pending" : "idle";
  }, [location.pathname, location.search, setScrollDataReady]);

  // After navigation, begin restore quickly — restoreLoop waits for content height.
  useEffect(() => {
    if (stateRef.current !== "pending") return;

    const myToken = tokenRef.current;
    const myKey = routeKeyRef.current;

    const trigger = () => {
      if (myToken !== tokenRef.current) return;
      if (stateRef.current !== "pending") return;
      const container = getContainer();
      if (!container) return;
      const saved = readEntry(myKey);
      if (!saved) {
        stateRef.current = "idle";
        setScrollDataReady(true);
        return;
      }
      stateRef.current = "restoring";
      restoreLoop(container, saved, myToken);
    };

    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(trigger);
    });
    const t = window.setTimeout(trigger, RESTORE_FALLBACK_MS);
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      window.clearTimeout(t);
    };
  }, [location.pathname, location.search, setScrollDataReady]);

  // rAF loop that waits for content height to grow, then snaps once.
  // Token-guarded so a stale loop from a previous navigation can never fire.
  function restoreLoop(
    container: HTMLElement,
    saved: ScrollData,
    token: number,
  ) {
    let frames = 0;
    let lastHeight = -1;
    let stableFrames = 0;
    const step = () => {
      if (token !== tokenRef.current) return;            // newer nav
      if (stateRef.current !== "restoring") return;      // user-scroll abort
      frames++;
      const h = container.scrollHeight;
      if (h === lastHeight) stableFrames++;
      else stableFrames = 0;
      lastHeight = h;
      const reachable = h >= saved.scrollTop + container.clientHeight * 0.6;
      if (reachable || stableFrames >= 3 || frames >= 120) {
        container.scrollTop = saved.scrollTop;
        container.scrollLeft = saved.scrollLeft;
        // Tiny grace window: after we set scrollTop, the browser fires a scroll
        // event. Skip that frame's save by staying in 'restoring' for one more
        // tick before flipping back to 'idle'.
        requestAnimationFrame(() => {
          if (token === tokenRef.current && stateRef.current === "restoring") {
            stateRef.current = "idle";
            setScrollDataReady(true);
          }
        });
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // Persist on user-driven scrolls; pivot out of 'pending' if the user
  // scrolls before restore happens (they've expressed intent — don't fight them).
  useEffect(() => {
    const container = getContainer();
    if (!container) return;

    const onScroll = () => {
      if (stateRef.current === "restoring") return;
      if (stateRef.current === "pending") {
        stateRef.current = "idle";
        setScrollDataReady(true);
      }
      writeEntry(routeKeyRef.current, {
        scrollTop: container.scrollTop,
        scrollLeft: container.scrollLeft,
      });
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [setScrollDataReady]);

  return null;
}
