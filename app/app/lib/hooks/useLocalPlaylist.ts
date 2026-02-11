import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "ff_playlist";

function readIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id: unknown) => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

function writeIds(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {}
}

export function useLocalPlaylist() {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    setIds(readIds());
  }, []);

  const add = useCallback((fileId: string) => {
    setIds((prev) => {
      if (prev.includes(fileId)) return prev;
      const next = [fileId, ...prev];
      writeIds(next);
      return next;
    });
  }, []);

  const remove = useCallback((fileId: string) => {
    setIds((prev) => {
      const next = prev.filter((id) => id !== fileId);
      writeIds(next);
      return next;
    });
  }, []);

  const toggle = useCallback((fileId: string) => {
    setIds((prev) => {
      const exists = prev.includes(fileId);
      const next = exists ? prev.filter((id) => id !== fileId) : [fileId, ...prev];
      writeIds(next);
      return next;
    });
  }, []);

  const has = useCallback((fileId: string) => ids.includes(fileId), [ids]);

  const clear = useCallback(() => {
    writeIds([]);
    setIds([]);
  }, []);

  return { ids, count: ids.length, add, remove, toggle, has, clear };
}

export function getPlaylistIds(): string[] {
  return readIds();
}
