import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { arrayMove } from "@dnd-kit/sortable";
import type { FileType } from "~/lib/types";

/** dnd-kit id for a queued file (matches sortable item ids). */
export function playQueueItemId(fileId: string) {
  return `queue:${fileId}`;
}

/** dnd-kit id for a related / sidebar video being dragged into the queue. */
export function relatedVideoDragId(fileId: string) {
  return `related:${fileId}`;
}

export const PLAY_QUEUE_DROP_EMPTY = "queue-empty";
export const PLAY_QUEUE_DROP_APPEND = "queue-append";

function dedupeById(videos: FileType[]): FileType[] {
  const seen = new Set<string>();
  const out: FileType[] = [];
  for (const v of videos) {
    if (!v?.id || seen.has(v.id)) continue;
    seen.add(v.id);
    out.push(v);
  }
  return out;
}

type PlayQueueContextValue = {
  currentUniqueId: string;
  defaultQueue: FileType[];
  /** Working queue (matches default until user edits). */
  queue: FileType[];
  isCustomized: boolean;
  effectiveSeriesUpNext: FileType[];
  effectiveSuggested: FileType[];
  moveUp: (index: number) => void;
  moveDown: (index: number) => void;
  removeAt: (index: number) => void;
  addToQueue: (video: FileType) => void;
  /** Move or insert a video at a target index (dedupes by file id; no duplicate entries). */
  insertOrMoveAt: (video: FileType, beforeIndex: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  resetQueue: () => void;
  isInQueue: (fileId: string) => boolean;
  /** Signed-in users only: customize queue, drag-and-drop, and add from sidebar. */
  viewerCanCustomizeQueue: boolean;
};

const PlayQueueContext = createContext<PlayQueueContextValue | null>(null);

export function PlayQueueProvider({
  children,
  currentUniqueId,
  seriesUpNextVideos,
  suggestedVideos,
  viewerCanCustomizeQueue = true,
}: {
  children: React.ReactNode;
  currentUniqueId: string;
  seriesUpNextVideos: FileType[];
  suggestedVideos: FileType[];
  viewerCanCustomizeQueue?: boolean;
}) {
  const defaultQueue = useMemo(() => {
    const merged = [...seriesUpNextVideos, ...suggestedVideos];
    return dedupeById(merged.filter((v) => v.unique_id !== currentUniqueId));
  }, [seriesUpNextVideos, suggestedVideos, currentUniqueId]);

  const [queue, setQueue] = useState<FileType[]>(defaultQueue);
  const [isCustomized, setIsCustomized] = useState(false);

  useEffect(() => {
    setQueue(defaultQueue);
    setIsCustomized(false);
  }, [currentUniqueId]);

  useEffect(() => {
    if (!isCustomized) {
      setQueue(defaultQueue);
    }
  }, [defaultQueue, isCustomized]);

  useEffect(() => {
    if (!viewerCanCustomizeQueue) {
      setQueue(defaultQueue);
      setIsCustomized(false);
    }
  }, [viewerCanCustomizeQueue, defaultQueue]);

  const applyQueue = useCallback(
    (updater: (base: FileType[]) => FileType[]) => {
      if (!viewerCanCustomizeQueue) return;
      setQueue((prev) => {
        const base = isCustomized ? prev : [...defaultQueue];
        return updater(base);
      });
      setIsCustomized(true);
    },
    [isCustomized, defaultQueue, viewerCanCustomizeQueue]
  );

  const moveUp = useCallback(
    (index: number) => {
      applyQueue((base) => {
        if (index <= 0 || index >= base.length) return base;
        const next = [...base];
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
        return next;
      });
    },
    [applyQueue]
  );

  const moveDown = useCallback(
    (index: number) => {
      applyQueue((base) => {
        if (index < 0 || index >= base.length - 1) return base;
        const next = [...base];
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
        return next;
      });
    },
    [applyQueue]
  );

  const removeAt = useCallback(
    (index: number) => {
      applyQueue((base) => base.filter((_, j) => j !== index));
    },
    [applyQueue]
  );

  const insertOrMoveAt = useCallback(
    (video: FileType, beforeIndex: number) => {
      if (video.unique_id === currentUniqueId) return;
      applyQueue((base) => {
        const fi = base.findIndex((v) => v.id === video.id);
        const without = base.filter((v) => v.id !== video.id);
        let insertAt = beforeIndex;
        if (fi !== -1 && fi < beforeIndex) insertAt = beforeIndex - 1;
        insertAt = Math.max(0, Math.min(insertAt, without.length));
        const next = [...without];
        next.splice(insertAt, 0, video);
        return next;
      });
    },
    [applyQueue, currentUniqueId]
  );

  const addToQueue = useCallback(
    (video: FileType) => {
      if (video.unique_id === currentUniqueId) return;
      applyQueue((base) => {
        if (base.some((v) => v.id === video.id)) return base;
        return [...base, video];
      });
    },
    [applyQueue, currentUniqueId]
  );

  const reorderQueue = useCallback(
    (fromIndex: number, toIndex: number) => {
      applyQueue((base) => {
        if (fromIndex < 0 || fromIndex >= base.length) return base;
        if (toIndex < 0 || toIndex >= base.length) return base;
        if (fromIndex === toIndex) return base;
        return arrayMove(base, fromIndex, toIndex);
      });
    },
    [applyQueue]
  );

  const resetQueue = useCallback(() => {
    if (!viewerCanCustomizeQueue) return;
    setQueue(defaultQueue);
    setIsCustomized(false);
  }, [defaultQueue, viewerCanCustomizeQueue]);

  const effectiveSeriesUpNext =
    viewerCanCustomizeQueue && isCustomized ? [] : seriesUpNextVideos;
  const effectiveSuggested =
    viewerCanCustomizeQueue && isCustomized ? queue : suggestedVideos;

  const isInQueue = useCallback(
    (fileId: string) =>
      viewerCanCustomizeQueue ? queue.some((v) => v.id === fileId) : false,
    [queue, viewerCanCustomizeQueue]
  );

  const value = useMemo(
    () => ({
      currentUniqueId,
      defaultQueue,
      queue,
      isCustomized,
      effectiveSeriesUpNext,
      effectiveSuggested,
      moveUp,
      moveDown,
      removeAt,
      addToQueue,
      insertOrMoveAt,
      reorderQueue,
      resetQueue,
      isInQueue,
      viewerCanCustomizeQueue,
    }),
    [
      currentUniqueId,
      defaultQueue,
      queue,
      isCustomized,
      effectiveSeriesUpNext,
      effectiveSuggested,
      moveUp,
      moveDown,
      removeAt,
      addToQueue,
      insertOrMoveAt,
      reorderQueue,
      resetQueue,
      isInQueue,
      viewerCanCustomizeQueue,
    ]
  );

  return (
    <PlayQueueContext.Provider value={value}>{children}</PlayQueueContext.Provider>
  );
}

export function usePlayQueue(): PlayQueueContextValue {
  const ctx = useContext(PlayQueueContext);
  if (!ctx) {
    throw new Error("usePlayQueue must be used within PlayQueueProvider");
  }
  return ctx;
}

/** Optional: sidebar can render without throwing when used outside provider. */
export function usePlayQueueOptional(): PlayQueueContextValue | null {
  return useContext(PlayQueueContext);
}
