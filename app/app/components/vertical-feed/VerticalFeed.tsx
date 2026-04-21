import { useCallback, useEffect, useRef, useState } from 'react';
import { useFileContext } from '~/lib/Context/Context';
import type { FileType } from '~/lib/types';
import { newReelFeedSeed } from '~/lib/feed/reelFeedSeed';
import { VerticalFeedContainer } from './VerticalFeedContainer';
import { fileToFeedItem, type ReelFeedResponse, type VerticalFeedItemData } from './types';

interface VerticalFeedProps {
  /** Paginate once the active index is within this many items of the end. */
  prefetchAhead?: number;
  /** Optional category filter passed to `/api/reel-feed`. */
  category?: string | null;
  /** Max video duration (seconds) passed to `/api/reel-feed`. */
  maxDuration?: number;
  initialActiveId?: string;
  className?: string;
  onActiveChange?: (file: FileType, index: number) => void;
}

export function VerticalFeed({
  prefetchAhead = 3,
  category = null,
  maxDuration,
  initialActiveId,
  className,
  onActiveChange,
}: VerticalFeedProps) {
  const { userId } = useFileContext();
  const [files, setFiles] = useState<FileType[]>([]);
  const [items, setItems] = useState<VerticalFeedItemData[]>([]);
  const [nextCursor, setNextCursor] = useState<{ cursor_pos: number } | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  const filesRef = useRef<FileType[]>([]);
  filesRef.current = files;
  const seenIdsRef = useRef<Set<string>>(new Set());
  const seedRef = useRef<string>(newReelFeedSeed());

  const loadFeed = useCallback(
    async (append: boolean) => {
      if (loading) return;
      if (!hasMore && append) return;

      setLoading(true);
      try {
        seedRef.current = newReelFeedSeed();
        const params = new URLSearchParams();
        params.set('seed', seedRef.current);
        if (category) params.set('category', category);
        if (maxDuration != null) params.set('max_duration', String(maxDuration));
        if (seenIdsRef.current.size > 0) {
          params.set(
            'exclude_ids',
            JSON.stringify(Array.from(seenIdsRef.current).slice(0, 500)),
          );
        }

        const res = await fetch(`/api/reel-feed?${params}`, {
          headers: { Accept: 'application/json' },
          credentials: 'include',
        });

        if (!res.ok) {
          setHasMore(false);
          return;
        }

        const payload = (await res.json()) as ReelFeedResponse;
        const incoming = Array.isArray(payload.data) ? payload.data : [];
        const likedSet = new Set(payload.userActions?.likedFileIds ?? []);
        const dislikedSet = new Set(payload.userActions?.dislikedFileIds ?? []);

        incoming.forEach((f) => {
          if (f.id) seenIdsRef.current.add(String(f.id));
        });

        setFiles((prev) => {
          const merged = append
            ? [
                ...prev,
                ...incoming.filter(
                  (f) => !prev.some((p) => p.id === f.id),
                ),
              ]
            : incoming;
          setItems(
            merged.map((f) => {
              const base = fileToFeedItem(f);
              return {
                ...base,
                file: f,
                liked: likedSet.has(String(f.id)) || base.liked,
                disliked: dislikedSet.has(String(f.id)) || base.disliked,
              };
            }),
          );
          return merged;
        });

        setNextCursor(payload.nextCursor ?? null);
        setHasMore(Boolean(payload.nextCursor) && Boolean(userId));
      } catch {
        setHasMore(false);
      } finally {
        setLoading(false);
        setInitialLoadDone(true);
      }
    },
    [category, hasMore, loading, maxDuration, userId],
  );

  useEffect(() => {
    seenIdsRef.current = new Set();
    seedRef.current = newReelFeedSeed();
    setFiles([]);
    setItems([]);
    setNextCursor(null);
    setHasMore(true);
    setInitialLoadDone(false);
    void loadFeed(false);
    // Reset + refetch when filters change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, maxDuration]);

  const handleActiveChange = useCallback(
    (_item: VerticalFeedItemData, index: number) => {
      const file = filesRef.current[index];
      if (file && onActiveChange) onActiveChange(file, index);

      const remaining = filesRef.current.length - 1 - index;
      if (userId && hasMore && !loading && remaining <= prefetchAhead) {
        void loadFeed(true);
      }
    },
    [userId, hasMore, loading, loadFeed, onActiveChange, prefetchAhead],
  );

  if (!initialLoadDone && items.length === 0) {
    return (
      <div className="flex h-[100dvh] w-full items-center justify-center bg-black">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex h-[100dvh] w-full flex-col items-center justify-center gap-2 bg-black px-4 text-white/80">
        <p className="text-center text-lg">No reels to show yet.</p>
        <p className="text-center text-sm">Check back later.</p>
      </div>
    );
  }

  return (
    <VerticalFeedContainer
      items={items}
      initialActiveId={initialActiveId}
      onActiveChange={handleActiveChange}
      className={className}
    />
  );
}
