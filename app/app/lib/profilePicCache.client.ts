import { useEffect, useState } from "react";

// Global per-user cache buster for profile pictures. After a successful upload
// we bump the user's counter; every <Avatar> that subscribes via
// useProfilePicCacheKey() automatically refetches the new pic. Without this,
// the navbar / sidebar / comment-author thumbs would keep showing the cached
// version for the full Cache-Control TTL (3h).
const counters = new Map<string, number>();
const EVT = "memories:profile-pic-bumped";
const STORAGE_KEY = "memories:profile-pic-bumps";

// Tab-local read with cross-tab catch-up from localStorage.
function readPersisted(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function writePersisted(map: Record<string, number>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode  ignore */
  }
}

export function bumpProfilePicCache(userId: string | null | undefined): void {
  if (!userId) return;
  const next = (counters.get(userId) ?? readPersisted()[userId] ?? 0) + 1;
  counters.set(userId, next);
  if (typeof window === "undefined") return;
  const persisted = readPersisted();
  persisted[userId] = next;
  writePersisted(persisted);
  window.dispatchEvent(new CustomEvent(EVT, { detail: { userId, value: next } }));
}

export function useProfilePicCacheKey(userId: string | null | undefined): number {
  const [tick, setTick] = useState<number>(() => {
    if (!userId) return 0;
    return counters.get(userId) ?? readPersisted()[userId] ?? 0;
  });

  useEffect(() => {
    if (!userId) return;
    const apply = () => {
      const v = counters.get(userId) ?? readPersisted()[userId] ?? 0;
      setTick(v);
    };
    apply();
    const onBump = (e: Event) => {
      const d = (e as CustomEvent<{ userId: string }>).detail;
      if (d?.userId === userId) apply();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) apply();
    };
    window.addEventListener(EVT, onBump as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVT, onBump as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, [userId]);

  return tick;
}
