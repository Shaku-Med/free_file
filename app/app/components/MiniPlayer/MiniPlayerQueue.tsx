import { useEffect, useRef, useState } from "react";
import { Loader2, ListVideo, Play } from "lucide-react";
import type { FileType } from "~/lib/types";
import { getThumbnailUrl, ParseFilename } from "~/lib/utils";
import { BASE_URL } from "~/lib/URLS";
import { cn } from "~/lib/utils";

type QueueFile = FileType & { owner?: { username?: string } | null };

function fmtDuration(sec: unknown): string | null {
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0) return null;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

function titleOf(f: QueueFile): string {
  const t = f.file_title || ParseFilename(f.filename);
  return typeof t === "string" ? t : (t as string[]).join("");
}

function thumbOf(f: QueueFile): string {
  return getThumbnailUrl(
    {
      default_thumbnail: f.default_thumbnail,
      thumbnails: f.thumbnails,
      file_type: f.file_type,
      endpoint: f.endpoint ?? "",
      created_at: f.created_at ?? "",
      unique_id: String(f.unique_id ?? ""),
      filename: f.filename ?? "",
    },
    { baseUrl: BASE_URL, queryString: "?quality=50&is_metadata=true" },
  );
}

function Row({
  file,
  active,
  onPlay,
}: {
  file: QueueFile;
  active?: boolean;
  onPlay: (f: QueueFile) => void;
}) {
  const dur = fmtDuration(file.duration);
  const channel = file.owner?.username;
  return (
    <button
      type="button"
      onClick={() => onPlay(file)}
      className={cn(
        "flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors",
        active ? "bg-white/15" : "hover:bg-white/10",
      )}
    >
      <div className="relative aspect-video w-[68px] shrink-0 overflow-hidden rounded-md bg-white/5">
        {thumbOf(file) ? (
          <img src={thumbOf(file)} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : null}
        {active ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Play className="h-4 w-4 fill-white text-white" />
          </span>
        ) : null}
        {dur ? (
          <span className="absolute bottom-0.5 right-0.5 rounded bg-black/80 px-1 text-[9px] font-semibold tabular-nums text-white">
            {dur}
          </span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[11px] font-medium leading-snug text-white/90">
          {titleOf(file)}
        </p>
        {channel ? <p className="mt-0.5 truncate text-[10px] text-white/45">{channel}</p> : null}
      </div>
    </button>
  );
}

/**
 * Up-next list shown under the mini player when expanded. Sourced from
 * /api/related-videos for the current file (the root play queue is empty once
 * you navigate away from the watch page). Clicking a row plays that video.
 */
export default function MiniPlayerQueue({
  current,
  onPlay,
  maxHeight,
}: {
  current: QueueFile;
  onPlay: (f: QueueFile) => void;
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
        <Row file={current} active onPlay={onPlay} />
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-white/40" />
          </div>
        ) : items.length === 0 ? (
          <p className="px-3 py-3 text-center text-[11px] text-white/40">Nothing up next.</p>
        ) : (
          items.map((f) => <Row key={String(f.unique_id)} file={f} onPlay={onPlay} />)
        )}
      </div>
    </div>
  );
}
