import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Client-side rate limiter ("bounce limit"): stops an action from firing more
 * than once per `intervalMs`, so mashing a button (reload comments, like) can't
 * flood the API. This is a first line of defense for UX — the server should
 * still enforce its own rate limits; a client guard is trivially bypassable.
 *
 * `attempt()` returns true and starts the cooldown when allowed, or false when
 * still cooling down. `coolingDown` is for disabling/styling the control.
 */
export function useRateLimit(intervalMs: number) {
  const lastRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [coolingDown, setCoolingDown] = useState(false);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const attempt = useCallback((): boolean => {
    const now = Date.now();
    if (now - lastRef.current < intervalMs) return false;
    lastRef.current = now;
    setCoolingDown(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCoolingDown(false), intervalMs);
    return true;
  }, [intervalMs]);

  return { attempt, coolingDown };
}
