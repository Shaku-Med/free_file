import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "ff_playlist";

/** Fired on same-tab updates so every `useLocalPlaylist()` instance stays in sync. */
export const LOCAL_PLAYLIST_CHANGED_EVENT = "ff-local-playlist-changed";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeLocalPlaylistFileId(id: string | null | undefined): string | null {
  if (id == null || typeof id !== "string") return null;
  const t = id.trim().toLowerCase();
  if (!t || !UUID_RE.test(t)) return null;
  return t;
}

function readIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const id of parsed) {
      const n = normalizeLocalPlaylistFileId(typeof id === "string" ? id : String(id));
      if (n && !out.includes(n)) out.push(n);
    }
    return out;
  } catch {
    return [];
  }
}

function writeIds(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    window.dispatchEvent(new Event(LOCAL_PLAYLIST_CHANGED_EVENT));
  } catch {}
}

export function useLocalPlaylist() {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    const sync = () => setIds(readIds());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) sync();
    };
    sync();
    window.addEventListener(LOCAL_PLAYLIST_CHANGED_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(LOCAL_PLAYLIST_CHANGED_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const add = useCallback((fileId: string) => {
    const n = normalizeLocalPlaylistFileId(fileId);
    if (!n) return;
    setIds((prev) => {
      if (prev.includes(n)) return prev;
      const next = [n, ...prev];
      writeIds(next);
      return next;
    });
  }, []);

  const remove = useCallback((fileId: string) => {
    const n = normalizeLocalPlaylistFileId(fileId);
    if (!n) return;
    setIds((prev) => {
      const next = prev.filter((id) => id !== n);
      writeIds(next);
      return next;
    });
  }, []);

  const toggle = useCallback((fileId: string) => {
    const n = normalizeLocalPlaylistFileId(fileId);
    if (!n) return;
    setIds((prev) => {
      const exists = prev.includes(n);
      const next = exists ? prev.filter((id) => id !== n) : [n, ...prev];
      writeIds(next);
      return next;
    });
  }, []);

  const has = useCallback(
    (fileId: string) => {
      const n = normalizeLocalPlaylistFileId(fileId);
      return n ? ids.includes(n) : false;
    },
    [ids]
  );

  const clear = useCallback(() => {
    writeIds([]);
    setIds([]);
  }, []);

  return { ids, count: ids.length, add, remove, toggle, has, clear };
}

export function getPlaylistIds(): string[] {
  return readIds();
}
