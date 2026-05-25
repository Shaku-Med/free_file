import { useCallback, useEffect, useRef, useState } from "react";
import { useFileContext } from "~/lib/Context/Context";
import { useDebouncedValue } from "~/lib/hooks/useDebouncedValue";
import type { FileType } from "~/lib/types";

export type SearchUser = {
  id: string;
  username: string;
  profile_pic: string;
  file_count: number;
};

const SEARCH_DEBOUNCE_MS = 400;

export function useSearchPanel(open: boolean) {
  const { userActions: globalUserActions, userId } = useFileContext();
  const [inputValue, setInputValue] = useState("");
  const debouncedTerm = useDebouncedValue(inputValue.trim(), SEARCH_DEBOUNCE_MS);

  const [files, setFiles] = useState<FileType[]>([]);
  const [searchUsers, setSearchUsers] = useState<SearchUser[]>([]);
  const [localUserActions, setLocalUserActions] = useState<{
    likedFileIds: Set<string>;
    dislikedFileIds: Set<string>;
  }>({ likedFileIds: new Set(), dislikedFileIds: new Set() });
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [suggestions, setSuggestions] = useState<FileType[]>([]);
  const [seriesRoots, setSeriesRoots] = useState<FileType[]>([]);
  const nextCursorRef = useRef<{ cursor_score: number; cursor_id: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const suggestionsAbortRef = useRef<AbortController | null>(null);
  /** Last term we fetched  skip refetch when user reopens / refocuses the same query. */
  const lastFetchedTermRef = useRef<string | null>(null);
  const prevDebouncedTermRef = useRef("");
  const suggestionsLoadedRef = useRef(false);

  const runSearch = useCallback(async (term: string, append: boolean) => {
    if (!term.trim()) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (append) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
    }

    try {
      const params = new URLSearchParams();
      params.set("q", term.trim());
      if (append && nextCursorRef.current) {
        params.set("cursor_score", String(nextCursorRef.current.cursor_score));
        params.set("cursor_id", nextCursorRef.current.cursor_id);
      }

      const response = await fetch(`/api/search?${params}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setHasMore(false);
        return;
      }

      const result = await response.json();
      const newFiles = Array.isArray(result.data) ? result.data : [];
      const newUsers = Array.isArray(result.users) ? result.users : [];

      if (append) {
        setFiles((prev) => {
          const existingIds = new Set(prev.map((f) => f.id));
          const added = newFiles.filter((f: FileType) => !existingIds.has(f.id));
          return [...prev, ...added];
        });
      } else {
        setFiles(newFiles);
        setSearchUsers(newUsers);
        const sr = Array.isArray(result.seriesRoots) ? result.seriesRoots : [];
        setSeriesRoots(sr as FileType[]);
      }

      nextCursorRef.current = result.nextCursor ?? null;
      setHasMore(Boolean(result.nextCursor));

      if (result.userActions) {
        setLocalUserActions((prev) => {
          const liked = new Set(prev.likedFileIds);
          const disliked = new Set(prev.dislikedFileIds);
          result.userActions.likedFileIds?.forEach((id: string) => liked.add(id));
          result.userActions.dislikedFileIds?.forEach((id: string) => disliked.add(id));
          return { likedFileIds: liked, dislikedFileIds: disliked };
        });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setHasMore(false);
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, []);

  const loadSuggestions = useCallback(async () => {
    suggestionsAbortRef.current?.abort();
    const controller = new AbortController();
    suggestionsAbortRef.current = controller;

    try {
      const response = await fetch("/api/feed", { signal: controller.signal });
      if (controller.signal.aborted || !response.ok) return;
      const result = await response.json();
      if (!Array.isArray(result.data)) return;
      setSuggestions(result.data);
      suggestionsLoadedRef.current = true;
      if (result.userActions) {
        setLocalUserActions((prev) => {
          const liked = new Set(prev.likedFileIds);
          const disliked = new Set(prev.dislikedFileIds);
          result.userActions.likedFileIds?.forEach((id: string) => liked.add(id));
          result.userActions.dislikedFileIds?.forEach((id: string) => disliked.add(id));
          return { likedFileIds: liked, dislikedFileIds: disliked };
        });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }, []);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      suggestionsAbortRef.current?.abort();
      return;
    }

    setLocalUserActions({
      likedFileIds: new Set(globalUserActions.likedFileIds),
      dislikedFileIds: new Set(globalUserActions.dislikedFileIds),
    });
  }, [open, globalUserActions]);

  // Fetch only when the debounced query changes  not on every dropdown open/focus.
  useEffect(() => {
    const prevTerm = prevDebouncedTermRef.current;

    if (debouncedTerm) {
      prevDebouncedTermRef.current = debouncedTerm;
      if (lastFetchedTermRef.current === debouncedTerm) {
        return;
      }
      lastFetchedTermRef.current = debouncedTerm;
      nextCursorRef.current = null;
      void runSearch(debouncedTerm, false);
      return;
    }

    const hadSearch = Boolean(prevTerm);
    prevDebouncedTermRef.current = debouncedTerm;
    lastFetchedTermRef.current = null;

    if (hadSearch) {
      setFiles([]);
      setSearchUsers([]);
      setSeriesRoots([]);
      setHasMore(false);
      nextCursorRef.current = null;
      setIsLoading(false);
    }

    if (!open) return;
    if (suggestionsLoadedRef.current) return;
    void loadSuggestions();
  }, [open, debouncedTerm, runSearch, loadSuggestions]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      suggestionsAbortRef.current?.abort();
    };
  }, []);

  const loadMore = useCallback(() => {
    if (isLoadingMore || !hasMore || !debouncedTerm) return;
    void runSearch(debouncedTerm, true);
  }, [isLoadingMore, hasMore, debouncedTerm, runSearch]);

  const reset = useCallback(() => {
    setInputValue("");
    setFiles([]);
    setSearchUsers([]);
    setSeriesRoots([]);
    setSuggestions([]);
    setHasMore(false);
    nextCursorRef.current = null;
    lastFetchedTermRef.current = null;
    prevDebouncedTermRef.current = "";
    suggestionsLoadedRef.current = false;
  }, []);

  return {
    inputValue,
    setInputValue,
    debouncedTerm,
    files,
    searchUsers,
    seriesRoots,
    suggestions,
    localUserActions,
    hasMore,
    isLoading,
    isLoadingMore,
    loadMore,
    reset,
    userId,
  };
}
