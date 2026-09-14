import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedValue } from "~/lib/hooks/useDebouncedValue";
import {
  addSearchHistory,
  getSearchHistory,
  matchSearchHistory,
  removeSearchHistory,
} from "~/lib/search/searchHistory";

// Empty box: this device's own search history. Typing: matching history first,
// then what other people search most for that prefix, then content titles.

const SUGGEST_DEBOUNCE_MS = 180;
const CACHE_MAX = 100;
const EMPTY_HISTORY_LIMIT = 10;
const TYPED_HISTORY_LIMIT = 3;
const MAX_ITEMS = 12;

export type SuggestionThumb = {
  unique_id: string;
  created_at: string;
  default_thumbnail: string | null;
  filename: string;
};

export type SearchSuggestion = {
  text: string;
  kind: "recent" | "popular" | "match";
  thumb?: SuggestionThumb | null;
};

type RemoteSuggestion = SearchSuggestion & { kind: "popular" | "match" };

const suggestionCache = new Map<string, RemoteSuggestion[]>();

function cachePut(term: string, items: RemoteSuggestion[]) {
  if (suggestionCache.size >= CACHE_MAX) {
    const oldest = suggestionCache.keys().next().value;
    if (oldest !== undefined) suggestionCache.delete(oldest);
  }
  suggestionCache.set(term, items);
}

function isThumb(v: unknown): v is SuggestionThumb {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return typeof t.unique_id === "string" && typeof t.created_at === "string";
}

// "recent" is rejected: only this device may put an entry in the history section.
function isRemoteSuggestion(v: unknown): v is RemoteSuggestion {
  if (!v || typeof v !== "object") return false;
  const o = v as { text?: unknown; kind?: unknown; thumb?: unknown };
  return (
    typeof o.text === "string" &&
    o.text.length > 0 &&
    o.text.length <= 200 &&
    (o.kind === "popular" || o.kind === "match") &&
    (o.thumb == null || isThumb(o.thumb))
  );
}

export function useSearchPanel(open: boolean) {
  const [inputValue, setInputValue] = useState("");
  const term = inputValue.trim();
  const debouncedTerm = useDebouncedValue(term, SUGGEST_DEBOUNCE_MS);

  const [remote, setRemote] = useState<{ term: string; list: RemoteSuggestion[] }>({ term: "", list: [] });
  const [historyVersion, setHistoryVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchSuggestions = useCallback(async (q: string) => {
    const cached = suggestionCache.get(q);
    if (cached) {
      setRemote({ term: q, list: cached });
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);

    try {
      const params = new URLSearchParams({ suggest: "1", q });
      const response = await fetch(`/api/search?${params}`, { signal: controller.signal });
      if (controller.signal.aborted || !response.ok) return;
      const result = (await response.json()) as { items?: unknown };
      const list = Array.isArray(result.items) ? result.items.filter(isRemoteSuggestion) : [];
      cachePut(q, list);
      setRemote({ term: q, list });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setRemote({ term: q, list: [] });
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !debouncedTerm) {
      abortRef.current?.abort();
      setIsLoading(false);
      return;
    }
    void fetchSuggestions(debouncedTerm);
  }, [open, debouncedTerm, fetchSuggestions]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const items = useMemo<SearchSuggestion[]>(() => {
    if (!open) return [];
    if (!term) {
      return getSearchHistory(EMPTY_HISTORY_LIMIT).map((text) => ({ text, kind: "recent" as const }));
    }

    const local = matchSearchHistory(term, TYPED_HISTORY_LIMIT).map((text) => ({ text, kind: "recent" as const }));
    const seen = new Set(local.map((i) => i.text.toLowerCase()));
    const lowerTerm = term.toLowerCase();

    // While the debounce catches up, keep the previous list but only what still fits.
    const stale = remote.term.toLowerCase() !== lowerTerm;
    const fromServer = remote.list.filter((i) => {
      const key = i.text.toLowerCase();
      if (seen.has(key)) return false;
      if (stale && !key.includes(lowerTerm)) return false;
      seen.add(key);
      return true;
    });

    return [...local, ...fromServer].slice(0, MAX_ITEMS);
  }, [open, term, remote, historyVersion]);

  const reset = useCallback(() => {
    setInputValue("");
    setRemote({ term: "", list: [] });
    setIsLoading(false);
  }, []);

  const recordSearch = useCallback((query: string) => {
    addSearchHistory(query);
    setHistoryVersion((v) => v + 1);
  }, []);

  const removeRecent = useCallback((query: string) => {
    removeSearchHistory(query);
    setHistoryVersion((v) => v + 1);
  }, []);

  return {
    inputValue,
    setInputValue,
    debouncedTerm,
    items,
    isLoading,
    reset,
    recordSearch,
    removeRecent,
  };
}
