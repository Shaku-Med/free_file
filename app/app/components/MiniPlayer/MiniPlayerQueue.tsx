import { Loader2, ListVideo } from "lucide-react";
import type { FileType } from "~/lib/types";
import VideoCard from "~/routes/Home/components/VideoCard";

type QueueFile = FileType & { owner?: { username?: string } | null };

/**
 * Up-next list under the mini player. Rows use `VideoCard` (`miniQueue` layout).
 * Data is supplied by `MiniPlayer` — fetched once per video and cached until
 * the user plays a different video in the mini.
 */
export default function MiniPlayerQueue({
  current,
  items,
  loading,
  onPlay,
  busyId,
  maxHeight,
}: {
  current: QueueFile;
  items: QueueFile[];
  loading: boolean;
  onPlay: (f: QueueFile) => void;
  busyId?: string | null;
  maxHeight: number;
}) {
  return (
    <div className="flex flex-col border-t border-border/50 bg-card/95">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <ListVideo className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Up next
        </span>
      </div>
      <div className="overflow-y-auto overscroll-contain" style={{ maxHeight }}>
        <VideoCard
          data={current}
          layout="miniQueue"
          related
          queueActive
          hideActions={{ completely: true }}
          onQueueSelect={() => {}}
        />
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <p className="px-3 py-3 text-center text-[11px] text-muted-foreground">Nothing up next.</p>
        ) : (
          items.map((f, index) => (
            <VideoCard
              key={String(f.unique_id)}
              data={f}
              layout="miniQueue"
              related
              index={index}
              hideActions={{ completely: true }}
              queueBusy={busyId === f.unique_id}
              onQueueSelect={() => onPlay(f)}
            />
          ))
        )}
      </div>
    </div>
  );
}
