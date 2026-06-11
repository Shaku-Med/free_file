import { useCallback, useEffect, useRef, useState } from "react";
import { useDebouncedValue } from "~/lib/hooks/useDebouncedValue";

/**
 * YouTube-style navbar search: typing fetches TEXT suggestions only
 * (/api/search?suggest=1 — no embeddings, no video rows). The full result
 * page with video cards is reached by pressing Enter / picking a suggestion.
 */

const SUGGEST_DEBOUNCE_MS = 180;
const CACHE_MAX = 100;

/** Session-lived completion cache: backspacing through a query costs nothing. */
const suggestionCache = new Map<string, string[]>();

function cachePut(term: string, suggestions: string[]) {
  if (suggestionCache.size >= CACHE_MAX) {
    const oldest = suggestionCache.keys().next().value;
    if (oldest !== undefined) suggestionCache.delete(oldest);
  }
  suggestionCache.set(term, suggestions);
}

export function useSearchPanel(open: boolean) {
  const [inputValue, setInputValue] = useState("");
  const debouncedTerm = useDebouncedValue(inputValue.trim(), SUGGEST_DEBOUNCE_MS);

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchSuggestions = useCallback(async (term: string) => {
    const cached = suggestionCache.get(term);
    if (cached) {
      setSuggestions(cached);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);

    try {
      const params = new URLSearchParams({ q: term, suggest: "1" });
      const response = await fetch(`/api/search?${params}`, { signal: controller.signal });
      if (controller.signal.aborted || !response.ok) return;
      const result = (await response.json()) as { suggestions?: unknown };
      const list = Array.isArray(result.suggestions)
        ? result.suggestions.filter((s): s is string => typeof s === "string" && s.length > 0)
        : [];
      cachePut(term, list);
      setSuggestions(list);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setSuggestions([]);
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      return;
    }
    if (!debouncedTerm) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }
    void fetchSuggestions(debouncedTerm);
  }, [open, debouncedTerm, fetchSuggestions]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    setInputValue("");
    setSuggestions([]);
    setIsLoading(false);
  }, []);

  return {
    inputValue,
    setInputValue,
    debouncedTerm,
    suggestions,
    isLoading,
    reset,
  };
}
