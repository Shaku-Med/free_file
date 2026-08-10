import { useCallback, useEffect, useRef, useState } from "react";
import { useDebouncedValue } from "~/lib/hooks/useDebouncedValue";

/**
 * YouTube-style navbar search:
 *   - empty box (on focus)  shows the user's recent searches + popular queries
 *   - typing               shows popularity-ranked query matches + content completions
 * The full result page with video cards is reached on Enter / picking a row.
 */

const SUGGEST_DEBOUNCE_MS = 180;
const CACHE_MAX = 100;

/** Optional preview attached server side; absent whenever nothing matched. */
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

/** Session cache for TYPED terms only; the empty box always refetches so recent
 *  searches stay fresh after a new search or a removal. */
const suggestionCache = new Map<string, SearchSuggestion[]>();

function cachePut(term: string, items: SearchSuggestion[]) {
  if (!term) return;
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

function isSuggestion(v: unknown): v is SearchSuggestion {
  if (!v || typeof v !== "object") return false;
  const o = v as { text?: unknown; kind?: unknown; thumb?: unknown };
  return (
    typeof o.text === "string" &&
    o.text.length > 0 &&
    (o.kind === "recent" || o.kind === "popular" || o.kind === "match") &&
    // Absent or null is normal; a malformed one is dropped rather than
    // rendered, so a bad payload cannot put a broken image in the dropdown.
    (o.thumb == null || isThumb(o.thumb))
  );
}

export function useSearchPanel(open: boolean) {
  const [inputValue, setInputValue] = useState("");
  const debouncedTerm = useDebouncedValue(inputValue.trim(), SUGGEST_DEBOUNCE_MS);

  const [items, setItems] = useState<SearchSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchSuggestions = useCallback(async (term: string) => {
    const cached = term ? suggestionCache.get(term) : undefined;
    if (cached) {
      setItems(cached);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);

    try {
      const params = new URLSearchParams({ suggest: "1" });
      if (term) params.set("q", term);
      const response = await fetch(`/api/search?${params}`, { signal: controller.signal });
      if (controller.signal.aborted || !response.ok) return;
      const result = (await response.json()) as { items?: unknown };
      const list = Array.isArray(result.items) ? result.items.filter(isSuggestion) : [];
      cachePut(term, list);
      setItems(list);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setItems([]);
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      return;
    }
    void fetchSuggestions(debouncedTerm);
  }, [open, debouncedTerm, fetchSuggestions]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    setInputValue("");
    setItems([]);
    setIsLoading(false);
  }, []);

  /** Remove one of the user's recent searches (the dropdown "x"). */
  const removeRecent = useCallback((query: string) => {
    setItems((prev) => prev.filter((i) => !(i.kind === "recent" && i.text === query)));
    suggestionCache.clear();
    void fetch("/api/search/recent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
      body: JSON.stringify({ query }),
    }).catch(() => {});
  }, []);

  return {
    inputValue,
    setInputValue,
    debouncedTerm,
    items,
    isLoading,
    reset,
    removeRecent,
  };
}
