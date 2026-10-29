import { useCallback, useEffect, useRef, useState } from "react";
import type { FileType } from "~/lib/types";

// The same feed as Home, asked for images only. It keeps its own seed, cursor
// and seen list so moving between Home and Posts never mixes the two.

// A seed is a bounded shuffle of the pool; when it runs dry a fresh one keeps
// the page going, a couple of times at most so an empty feed still ends.
const MAX_SEED_ROTATIONS = 2;
// The API reads at most this many ids to leave out.
const SEEN_IDS_WIRE_CAP = 500;

type Page = { data?: FileType[]; nextCursor?: { cursor_pos: number } | null };

export function usePostsFeed(category: string | null, signedIn: boolean) {
  const [posts, setPosts] = useState<FileType[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const seedRef = useRef("");
  const cursorRef = useRef<number | null>(null);
  const shownRef = useRef(new Set<string>());
  const busyRef = useRef(false);
  // Bumped whenever the list starts over, so an answer for the old category
  // that lands late is thrown away.
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const fetchPage = useCallback(
    async (append: boolean, signal: AbortSignal): Promise<Page | null> => {
      const params = new URLSearchParams({ media: "image", seed: seedRef.current });
      if (append && cursorRef.current != null) params.set("cursor_pos", String(cursorRef.current));
      const seen = Array.from(shownRef.current).slice(-SEEN_IDS_WIRE_CAP);
      if (seen.length > 0) params.set("exclude_ids", JSON.stringify(seen));
      if (category) params.set("category", category);
      const res = await fetch(`/api/feed?${params}`, { signal });
      if (!res.ok) return null;
      return (await res.json()) as Page;
    },
    [category],
  );

  const load = useCallback(
    async (append: boolean) => {
      if (busyRef.current && append) return;
      const generation = append ? generationRef.current : ++generationRef.current;
      if (!append) abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      busyRef.current = true;
      setLoading(true);
      if (!append) {
        seedRef.current = Date.now().toString();
        cursorRef.current = null;
        shownRef.current = new Set();
        setError(false);
      }
      try {
        let added = false;
        for (let rotation = 0; rotation <= MAX_SEED_ROTATIONS; rotation++) {
          const page = await fetchPage(append || rotation > 0, controller.signal);
          if (generation !== generationRef.current) return;
          if (!page) {
            if (!append && !added) setError(true);
            return;
          }
          const fresh = (page.data ?? []).filter((f) => f.id && !shownRef.current.has(f.id));
          if (fresh.length > 0) {
            for (const f of fresh) shownRef.current.add(f.id);
            setPosts((prev) => (append || rotation > 0 || added ? [...prev, ...fresh] : fresh));
            added = true;
          } else if (!append && rotation === 0) {
            setPosts([]);
          }
          if (page.nextCursor) {
            cursorRef.current = page.nextCursor.cursor_pos;
            setHasMore(true);
            return;
          }
          seedRef.current = `${Date.now()}_${rotation + 1}`;
          cursorRef.current = null;
        }
        setHasMore(added);
      } catch {
        if (generation === generationRef.current && !append) setError(true);
      } finally {
        if (generation === generationRef.current) {
          busyRef.current = false;
          setLoading(false);
          setInitialLoading(false);
        }
      }
    },
    [fetchPage],
  );

  useEffect(() => {
    setInitialLoading(true);
    setPosts([]);
    setHasMore(true);
    busyRef.current = false;
    void load(false);
  }, [load]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const loadMore = useCallback(() => {
    // Signed out, the first page is all there is, as on Home.
    if (!signedIn || !hasMore || error) return;
    void load(true);
  }, [signedIn, hasMore, error, load]);

  const retry = useCallback(() => void load(false), [load]);

  return { posts, loading, initialLoading, error, hasMore: signedIn && hasMore, loadMore, retry };
}
