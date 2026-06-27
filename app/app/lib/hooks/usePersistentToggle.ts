import { useCallback, useState } from "react";

/**
 * A boolean toggle backed by localStorage so it survives watch-page navigation
 * (the Dynamic route re-mounts its subtree per video, which would otherwise
 * reset things like "I collapsed the play queue / series list") and reloads.
 *
 * Drop-in for useState<boolean>: returns [value, setValue] with the same
 * functional-update signature. SSR-safe  on the server it returns `initial`;
 * the value is read from storage on the client's first render (and on every
 * client-side remount thereafter, which is the case we care about).
 */
export function usePersistentToggle(
  key: string,
  initial: boolean,
): [boolean, (value: boolean | ((prev: boolean) => boolean)) => void] {
  const [value, setValue] = useState<boolean>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? initial : raw === "1";
    } catch {
      return initial;
    }
  });

  const set = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: boolean) => boolean)(prev) : next;
        try {
          if (typeof window !== "undefined") {
            window.localStorage.setItem(key, resolved ? "1" : "0");
          }
        } catch {
          /* storage unavailable  keep in-memory only */
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, set];
}
