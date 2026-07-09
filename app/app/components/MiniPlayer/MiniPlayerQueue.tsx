import { useEffect, useRef, useState } from "react";
import { Loader2, ListVideo } from "lucide-react";
import type { FileType } from "~/lib/types";
import { cn } from "~/lib/utils";
import VideoCard from "~/routes/Home/components/VideoCard";

type QueueFile = FileType & { owner?: { username?: string } | null };

/**
 * One queue row: the app's VideoCard for the layout, but the click plays the
 * video IN the mini instead of navigating. VideoCard has no click-override, so
 * we intercept in the capture phase and stop its internal WatchLink from firing.
 */
function QueueRow({
  file,
  active,
  busy,
  onPlay,
}: {
  file: QueueFile;
  active?: boolean;
  busy?: boolean;
  onPlay: (f: QueueFile) => void;
}) {
  return (
    <div
      className={cn("dark relative cursor-pointer px-1.5 py-1", active && "bg-white/10")}
      onClickCapture={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!active) onPlay(file);
      }}
      aria-current={active ? "true" : undefined}
    >
      <VideoCard
        data={file}
        layout="compact"
        related
        hideActions={{ completely: true }}
      />
      {(busy || active) && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin text-white" />
          ) : (
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              Playing
            </span>
          )}
        </span>
      )}
    </div>
  );
}

/**
 * Up-next list under the mini player when expanded. Sourced from
 * /api/related-videos for the current file (the root play queue is empty once
 * you leave the watch page). Clicking a row plays that video in the mini.
 */
export default function MiniPlayerQueue({
  current,
  onPlay,
  busyId,
  maxHeight,
}: {
  current: QueueFile;
  onPlay: (f: QueueFile) => void;
  busyId?: string | null;
  maxHeight: number;
}) {
  const [items, setItems] = useState<QueueFile[]>([]);
  const [loading, setLoading] = useState(true);
  const seedId = String(current.id ?? "");
  const reqRef = useRef(0);

  useEffect(() => {
    if (!seedId) {
      setItems([]);
      setLoading(false);
      return;
    }
    const req = ++reqRef.current;
    setLoading(true);
    const params = new URLSearchParams({ fileId: seedId });
    fetch(`/api/related-videos?${params.toString()}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (req !== reqRef.current) return;
        const list = Array.isArray(json?.data) ? (json.data as QueueFile[]) : [];
        setItems(
          list.filter((f) => f && f.unique_id && f.unique_id !== current.unique_id && !f.is_reel),
        );
      })
      .catch(() => {
        if (req === reqRef.current) setItems([]);
      })
      .finally(() => {
        if (req === reqRef.current) setLoading(false);
      });
  }, [seedId, current.unique_id]);

  return (
    <div className="flex flex-col bg-zinc-900/95">
      <div className="flex items-center gap-2 border-t border-white/10 px-3 py-1.5">
        <ListVideo className="h-3.5 w-3.5 text-white/50" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-white/60">Up next</span>
      </div>
      <div className="overflow-y-auto overscroll-contain" style={{ maxHeight }}>
        <QueueRow file={current} active onPlay={onPlay} />
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-white/40" />
          </div>
        ) : items.length === 0 ? (
          <p className="px-3 py-3 text-center text-[11px] text-white/40">Nothing up next.</p>
        ) : (
          items.map((f) => (
            <QueueRow
              key={String(f.unique_id)}
              file={f}
              busy={busyId === f.unique_id}
              onPlay={onPlay}
            />
          ))
        )}
      </div>
    </div>
  );
}
