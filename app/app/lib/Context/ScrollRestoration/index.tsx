import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router";
import { useFileContext } from "~/lib/Context/Context";

/**
 * Per-route scroll memory — our own implementation, decoupled from
 * react-router's data router. Saves the scroll position of every visited
 * page to `sessionStorage` (so it survives within a tab but doesn't leak
 * across sessions). On return, snaps the container to the saved value
 * BEFORE paint so there's no "flash of top".
 *
 * Pipeline:
 *   1. On scroll → debounce-write to sessionStorage keyed by `path+search`.
 *   2. On route change (useLayoutEffect) → BEFORE the browser paints the
 *      new route, set scroll_container.scrollTop to the saved value.
 *      If content isn't tall enough yet, the browser clamps; we then
 *      keep retrying as soon as new content lands.
 *   3. ResizeObserver on scroll_container — every time its scrollHeight
 *      grows (lazy-loaded feed cards, image height settle, etc.), retry
 *      the snap until either we hit the target or the user scrolls.
 *   4. As soon as the user actually scrolls (real interaction, not our
 *      programmatic .scrollTop write), stop retrying — they've taken
 *      over and we don't want to fight them.
 *
 * Why not the built-in `<ScrollRestoration />`: that one uses RR's
 * router lifecycle and assumes loaders block paint until data lands.
 * Our app does a lot of client-side lazy loading, so we need to snap
 * AS CONTENT ARRIVES rather than at a single before-paint instant.
 */

const STORAGE_KEY = "memories.scroll.v2";
/** A scroll within this many px of the saved target is "close enough"
 *  and considered restored — avoids one-pixel jitter retries. */
const RESTORE_EPS = 2;
/** Give up retrying after this long; if content never gets tall enough,
 *  the user is on a page that genuinely doesn't have that much height. */
const RETRY_BUDGET_MS = 5000;

interface ScrollEntry {
  top: number;
  left: number;
}

type ScrollStore = Record<string, ScrollEntry>;

function keyFor(location: { pathname: string; search: string }): string {
  // search is part of the key so /search?q=foo and /search?q=bar have
  // independent scroll memory. hash is intentionally excluded so deep
  // anchors don't pollute the persistent feed scroll.
  return `${location.pathname}${location.search}`;
}

function readStore(): ScrollStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ScrollStore) : {};
  } catch {
    return {};
  }
}

function writeStore(store: ScrollStore) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* quota / private mode — ignore */
  }
}

function getEntry(key: string): ScrollEntry | null {
  return readStore()[key] ?? null;
}

function setEntry(key: string, entry: ScrollEntry) {
  const store = readStore();
  store[key] = entry;
  writeStore(store);
}

function getContainer(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById("scroll_container");
}

export default function ScrollRestoration() {
  const location = useLocation();
  const { setScrollDataReady } = useFileContext();
  const currentKeyRef = useRef<string>(keyFor(location));
  /** Whether the current route's restore is "settled" — either we hit
   *  the target, the user intervened, or we timed out. Until then, we
   *  keep grabbing height-grow events to retry the snap. */
  const settledRef = useRef(false);
  /** Bumped on every navigation. Async retries check this against their
   *  captured value and bail if a newer navigation has begun. */
  const tokenRef = useRef(0);
  /** Most recent scrollTop we wrote programmatically. The scroll listener
   *  uses this to ignore the echo from our own writes — without it, our
   *  own restore call would look like "user scrolled to X" and would
   *  immediately mark the page as settled (and worse, save the clamped
   *  value as the new target, overwriting the user's actual position). */
  const programmaticTopRef = useRef<number | null>(null);

  // SAVE on scroll. Throttle to once per animation frame so we don't
  // hammer sessionStorage on a long scroll. We always capture — even
  // before the route is "settled" — because if the user starts
  // scrolling immediately on arrival, THAT new position is what they
  // want remembered next time.
  useEffect(() => {
    const container = getContainer();
    if (!container) return;

    let rafId = 0;
    let pendingTop = 0;
    let pendingLeft = 0;
    let havePending = false;

    const flush = () => {
      rafId = 0;
      if (!havePending) return;
      havePending = false;
      setEntry(currentKeyRef.current, {
        top: pendingTop,
        left: pendingLeft,
      });
    };

    const onScroll = () => {
      const currentTop = container.scrollTop;
      // Echo of our own programmatic scroll? Skip it.
      if (
        programmaticTopRef.current !== null &&
        Math.abs(currentTop - programmaticTopRef.current) <= RESTORE_EPS
      ) {
        return;
      }
      // Real user scroll — they've taken over, stop our retries.
      programmaticTopRef.current = null;
      settledRef.current = true;
      pendingTop = currentTop;
      pendingLeft = container.scrollLeft;
      havePending = true;
      if (rafId === 0) rafId = window.requestAnimationFrame(flush);
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (rafId !== 0) window.cancelAnimationFrame(rafId);
      flush();
    };
  }, []);

  // RESTORE on navigation. useLayoutEffect runs BEFORE paint so a route
  // change with cached saved scroll lands at the right spot without any
  // visible flash of "top".
  useLayoutEffect(() => {
    const container = getContainer();
    if (!container) return;

    const previousKey = currentKeyRef.current;
    const newKey = keyFor(location);
    if (previousKey === newKey) return;

    // Persist whatever scroll the user had on the outgoing route. We
    // also do this on every scroll above, but the final value at
    // navigate-away time deserves to be saved with certainty.
    setEntry(previousKey, {
      top: container.scrollTop,
      left: container.scrollLeft,
    });

    currentKeyRef.current = newKey;
    tokenRef.current += 1;
    settledRef.current = false;

    const saved = getEntry(newKey);
    if (!saved) {
      // New / never-visited route: top.
      programmaticTopRef.current = 0;
      container.scrollTop = 0;
      container.scrollLeft = 0;
      settledRef.current = true;
      setScrollDataReady(true);
      return;
    }

    // First attempt synchronously — if the new content is already tall
    // enough (cached data, persistent layout, etc.) this is the only
    // attempt needed and the user sees zero scroll change.
    const targetTop = Math.max(0, saved.top);
    const targetLeft = Math.max(0, saved.left);
    programmaticTopRef.current = targetTop;
    container.scrollTop = targetTop;
    container.scrollLeft = targetLeft;

    // If the browser clamped us short of the target (content not yet
    // tall enough), the retry effect below will keep trying.
    if (Math.abs(container.scrollTop - targetTop) <= RESTORE_EPS) {
      settledRef.current = true;
      setScrollDataReady(true);
    } else {
      setScrollDataReady(false);
    }
  }, [location.pathname, location.search, setScrollDataReady]);

  // RETRY loop — runs after every navigation, watches the container's
  // scrollHeight via ResizeObserver. As new content lands and the
  // container grows tall enough, set scrollTop to the saved target.
  useEffect(() => {
    if (settledRef.current) return;

    const container = getContainer();
    if (!container) return;

    const myToken = tokenRef.current;
    const myKey = currentKeyRef.current;
    const saved = getEntry(myKey);
    if (!saved) {
      settledRef.current = true;
      setScrollDataReady(true);
      return;
    }
    const targetTop = Math.max(0, saved.top);
    const startedAt = performance.now();

    const tryRestore = () => {
      if (myToken !== tokenRef.current) return; // newer nav
      if (settledRef.current) return;            // user scrolled
      if (performance.now() - startedAt > RETRY_BUDGET_MS) {
        // Budget elapsed — give up so we don't fight long-running
        // streams of late-arriving content forever.
        settledRef.current = true;
        setScrollDataReady(true);
        return;
      }
      const max = container.scrollHeight - container.clientHeight;
      if (max <= 0) return; // wait — nothing to scroll yet
      const clamped = Math.min(targetTop, max);
      if (Math.abs(container.scrollTop - clamped) > RESTORE_EPS) {
        programmaticTopRef.current = clamped;
        container.scrollTop = clamped;
      }
      if (Math.abs(container.scrollTop - targetTop) <= RESTORE_EPS) {
        settledRef.current = true;
        setScrollDataReady(true);
      }
    };

    // Watch the container for size changes (children loading in).
    const ro = new ResizeObserver(() => tryRestore());
    ro.observe(container);
    // Also watch direct children — content height often grows as feed
    // cards mount even when the container itself isn't resizing.
    const childObs: ResizeObserver[] = [];
    for (const child of Array.from(container.children)) {
      if (child instanceof HTMLElement) {
        const obs = new ResizeObserver(() => tryRestore());
        obs.observe(child);
        childObs.push(obs);
      }
    }

    // One immediate try after layout settles — covers the case where
    // the container already has the right height at this useEffect.
    tryRestore();

    // Safety net: coarse poll for the first second to catch cases
    // where neither ResizeObserver fires (e.g. images decode and grow
    // without resizing the layout-driving parent).
    const interval = window.setInterval(tryRestore, 100);
    const stopPolling = window.setTimeout(() => {
      window.clearInterval(interval);
    }, 1000);

    return () => {
      ro.disconnect();
      for (const o of childObs) o.disconnect();
      window.clearInterval(interval);
      window.clearTimeout(stopPolling);
    };
  }, [location.pathname, location.search, setScrollDataReady]);

  return null;
}
