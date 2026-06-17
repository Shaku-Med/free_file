import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { MetaFunction } from "react-router";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GripVertical,
  ListOrdered,
  Loader2,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import VideoCard from "~/routes/Home/components/VideoCard";
import { useFileContext } from "~/lib/Context/Context";
import { buildPageMeta } from "~/lib/seo";
import { cn } from "~/lib/utils";
import type { FileType, SeriesEpisodeGroup } from "~/lib/types";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Series | Brozy Studio",
    description: "Arrange your series — reorder episodes and the videos inside them.",
    canonicalPath: "/brozystudio/series",
  });

type SeriesSummary = {
  fileSeriesId: string;
  mainUniqueId: string | null;
  title: string;
  thumbnail: string | null;
  episodeCount: number;
};

type EpisodeWithItems = { episodeId: string; episodeName: string; items: FileType[] };

/** Series are long-form: the picker hides reels and anything shorter than this. */
const MIN_SERIES_DURATION_SECONDS = 180; // 3 minutes

function flattenEpisodes(groups: SeriesEpisodeGroup[]): EpisodeWithItems[] {
  const out: EpisodeWithItems[] = [];
  const walk = (list: SeriesEpisodeGroup[]) => {
    for (const g of list) {
      out.push({
        episodeId: String(g.episode_id),
        episodeName: g.episode_name?.trim() || "Episode",
        items: Array.isArray(g.items) ? g.items : [],
      });
      if (g.nested?.length) walk(g.nested);
    }
  };
  walk(groups);
  return out;
}

/** A draggable video row — uses VideoCard's `studioRow` for the thumbnail + title. */
function SortableFile({
  file,
  index,
  currentUserId,
  onRemove,
  removing,
}: {
  file: FileType;
  index: number;
  currentUserId?: string;
  onRemove: () => void;
  removing: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(file.unique_id),
  });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    zIndex: isDragging ? 20 : undefined,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border/60 bg-card/40 p-2",
        isDragging && "opacity-80 shadow-lg ring-1 ring-primary/40",
      )}
    >
      <button
        type="button"
        className="shrink-0 cursor-grab touch-none rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="w-5 shrink-0 text-center text-xs font-semibold tabular-nums text-muted-foreground">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <VideoCard data={file} index={index} layout="seriesRow" currentUserId={currentUserId} />
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={removing}
        aria-label="Remove from series"
        className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
      >
        {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      </button>
    </li>
  );
}

/** One episode's videos with drag-to-reorder + save. */
function EpisodeBlock({
  fileSeriesId,
  episode,
  showHeader,
  currentUserId,
  onChanged,
}: {
  fileSeriesId: string;
  episode: EpisodeWithItems;
  showHeader: boolean;
  currentUserId?: string;
  /** Re-pull the series after a structural change (a video removed). */
  onChanged: () => void;
}) {
  const [items, setItems] = useState<FileType[]>(episode.items);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Re-sync if the parent reloads the series (e.g. after adding a file).
  useEffect(() => {
    setItems(episode.items);
    setDirty(false);
  }, [episode]);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const from = prev.findIndex((x) => String(x.unique_id) === active.id);
      const to = prev.findIndex((x) => String(x.unique_id) === over.id);
      if (from < 0 || to < 0) return prev;
      return arrayMove(prev, from, to);
    });
    setDirty(true);
    setSaved(false);
  };

  const save = () => {
    setSaving(true);
    fetch("/api/file-series", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reorder_items",
        fileSeriesId,
        episodeId: episode.episodeId,
        fileIds: items.map((i) => String(i.unique_id)),
      }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("save failed"))))
      .then(() => {
        setDirty(false);
        setSaved(true);
      })
      .catch(() => {})
      .finally(() => setSaving(false));
  };

  const removeFile = (uniqueId: string) => {
    setRemovingId(uniqueId);
    setItems((prev) => prev.filter((f) => String(f.unique_id) !== uniqueId)); // optimistic
    fetch("/api/file-series", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unassign", fileId: uniqueId }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("remove failed"))))
      .then(() => onChanged())
      .catch(() => onChanged()) // resync from server on failure
      .finally(() => setRemovingId(null));
  };

  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      {showHeader ? (
        <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {episode.episodeName}
        </p>
      ) : null}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={items.map((i) => String(i.unique_id))}
          strategy={verticalListSortingStrategy}
        >
          <ul className="flex flex-col gap-1.5">
            {items.map((file, i) => (
              <SortableFile
                key={String(file.unique_id)}
                file={file}
                index={i}
                currentUserId={currentUserId}
                onRemove={() => removeFile(String(file.unique_id))}
                removing={removingId === String(file.unique_id)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <div className="flex items-center justify-end gap-2">
        {saved && !dirty ? <span className="text-xs text-muted-foreground">Saved</span> : null}
        <Button size="sm" disabled={!dirty || saving} onClick={save} className="rounded-full">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
          Save order
        </Button>
      </div>
    </div>
  );
}

/**
 * An episode you can grab by its header and drag whole — its videos "fold" into
 * the header while dragging, then the inner list (with its own drag-to-reorder)
 * comes back on drop.
 */
function DraggableEpisode({
  fileSeriesId,
  episode,
  currentUserId,
  onAdd,
  onChanged,
}: {
  fileSeriesId: string;
  episode: EpisodeWithItems;
  currentUserId?: string;
  onAdd: () => void;
  onChanged: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: episode.episodeId,
  });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    zIndex: isDragging ? 30 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-lg border border-border/60 bg-card/30",
        isDragging && "opacity-95 shadow-xl ring-1 ring-primary/40",
      )}
    >
      <div className="flex items-center gap-2 px-2 py-2">
        <button
          type="button"
          className="shrink-0 cursor-grab touch-none rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
          aria-label="Drag episode"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <p className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {episode.episodeName}
        </p>
        <span className="shrink-0 text-xs text-muted-foreground">
          {episode.items.length} {episode.items.length === 1 ? "video" : "videos"}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 shrink-0 gap-1 rounded-full px-2 text-xs"
          onClick={onAdd}
          aria-label={`Add a video to ${episode.episodeName}`}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add
        </Button>
      </div>
      {isDragging ? null : (
        <div className="px-2 pb-2">
          <EpisodeBlock
            fileSeriesId={fileSeriesId}
            episode={episode}
            showHeader={false}
            currentUserId={currentUserId}
            onChanged={onChanged}
          />
        </div>
      )}
    </div>
  );
}

/** Draggable episode name (episode-reorder mode). */
function SortableEpisodeName({ ep, index }: { ep: EpisodeWithItems; index: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ep.episodeId,
  });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    zIndex: isDragging ? 20 : undefined,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border/60 bg-card/50 px-2.5 py-2",
        isDragging && "opacity-80 shadow-lg ring-1 ring-primary/40",
      )}
    >
      <button
        type="button"
        className="shrink-0 cursor-grab touch-none rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="w-5 shrink-0 text-center text-xs font-semibold tabular-nums text-muted-foreground">
        {index + 1}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{ep.episodeName}</span>
    </li>
  );
}

/** Pick one of the owner's own videos to add to a series. */
function AddFileDialog({
  open,
  onOpenChange,
  fileSeriesId,
  ownerId,
  episodeId,
  episodeName,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  fileSeriesId: string;
  ownerId: string;
  /** When set, files are added INTO this episode; otherwise each starts a new one. */
  episodeId?: string;
  episodeName?: string;
  onAdded: () => void;
}) {
  const [q, setQ] = useState("");
  const [files, setFiles] = useState<FileType[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acRef = useRef<AbortController | null>(null);
  const reqSeq = useRef(0);
  // Per-dialog cache so re-typing / clearing a query never re-hits the DB.
  const cacheRef = useRef<Map<string, FileType[]>>(new Map());

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    // Skip 1-char queries (noisy + needless load); keep the current results.
    if (term.length === 1) return;

    // Serve repeats from cache instantly — no network, no DB.
    const cached = cacheRef.current.get(term);
    if (cached) {
      setFiles(cached);
      setLoading(false);
      return;
    }

    if (tRef.current) clearTimeout(tRef.current);
    setLoading(true);
    // Debounce: only fetch once typing pauses (not per keystroke).
    tRef.current = setTimeout(() => {
      const myReq = ++reqSeq.current;
      acRef.current?.abort(); // cancel any in-flight search
      const ac = new AbortController();
      acRef.current = ac;
      const params = new URLSearchParams({
        ownerId,
        limit: "30",
        excludeReels: "1",
        minDuration: String(MIN_SERIES_DURATION_SECONDS),
      });
      if (term) params.set("q", term);
      fetch(`/api/owner-videos?${params.toString()}`, {
        credentials: "include",
        signal: ac.signal,
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { data?: FileType[] } | null) => {
          if (myReq !== reqSeq.current) return; // a newer query superseded this
          const list = (j?.data ?? []).filter(
            (f) => !f.is_series_main && !f.is_files_series_item,
          );
          cacheRef.current.set(term, list);
          setFiles(list);
        })
        .catch((err) => {
          if (myReq === reqSeq.current && (err as Error)?.name !== "AbortError") setFiles([]);
        })
        .finally(() => {
          if (myReq === reqSeq.current) setLoading(false);
        });
    }, 350);
    return () => {
      if (tRef.current) clearTimeout(tRef.current);
    };
  }, [open, q, ownerId]);

  // Drop the cache when the dialog closes so newly-uploaded files show next open.
  useEffect(() => {
    if (!open) cacheRef.current.clear();
  }, [open]);

  const add = (file: FileType) => {
    setAddingId(String(file.id));
    fetch("/api/file-series", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "assign",
        fileId: String(file.unique_id),
        fileSeriesId,
        isNewSeries: false,
        // Into a chosen episode, or as a brand-new episode named after the file.
        ...(episodeId
          ? { fileSeriesEpisodeId: episodeId }
          : { newEpisodeName: file.file_title?.trim() || file.filename || "Episode" }),
      }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("add failed"))))
      .then(() => {
        setFiles((prev) => prev.filter((f) => f.id !== file.id));
        onAdded();
      })
      .catch(() => {})
      .finally(() => setAddingId(null));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(85vh,640px)] max-w-lg flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3 text-left">
          <DialogTitle className="text-base">
            {episodeId ? `Add a video to “${episodeName ?? "this episode"}”` : "Add a video to this series"}
          </DialogTitle>
        </DialogHeader>
        <div className="shrink-0 border-b border-border/60 px-4 py-2.5">
          <div className="flex items-center gap-2 rounded-md border border-border/60 bg-card/40 px-2.5 py-1.5">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search your videos…"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            </div>
          ) : files.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {q.trim() ? "No matching videos." : "No videos available to add."}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {files.map((file) => (
                <li
                  key={String(file.id)}
                  className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 p-2"
                >
                  <div className="aspect-video h-12 shrink-0 overflow-hidden rounded-md bg-muted">
                    <VideoCard data={file} layout="notificationThumb" />
                  </div>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {file.file_title?.trim() || file.filename || "Untitled"}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="shrink-0 rounded-full"
                    disabled={addingId === String(file.id)}
                    onClick={() => add(file)}
                  >
                    {addingId === String(file.id) ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <>
                        <Plus className="mr-1 h-4 w-4" aria-hidden />
                        Add
                      </>
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Expandable card for one series. */
function SeriesCard({ series, currentUserId }: { series: SeriesSummary; currentUserId?: string }) {
  const [open, setOpen] = useState(false);
  const [episodes, setEpisodes] = useState<EpisodeWithItems[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  // null = closed; {} = add as a new episode; {episodeId} = add into that episode.
  const [addTarget, setAddTarget] = useState<{ episodeId?: string; episodeName?: string } | null>(
    null,
  );

  // Episode-reorder mode.
  const [epMode, setEpMode] = useState(false);
  const [epOrder, setEpOrder] = useState<EpisodeWithItems[]>([]);
  const [epDirty, setEpDirty] = useState(false);
  const [epSaving, setEpSaving] = useState(false);
  const epSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const load = useCallback(() => {
    if (!series.mainUniqueId) {
      setStatus("error");
      return;
    }
    setStatus("loading");
    fetch(`/api/dynamic-series?unique_id=${encodeURIComponent(series.mainUniqueId)}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { seriesEpisodes?: SeriesEpisodeGroup[] | null } | null) => {
        setEpisodes(flattenEpisodes(Array.isArray(j?.seriesEpisodes) ? j!.seriesEpisodes! : []));
        setStatus("idle");
        setEpMode(false);
      })
      .catch(() => setStatus("error"));
  }, [series.mainUniqueId]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && episodes === null && status === "idle") load();
  };

  const multiEpisode = (episodes?.length ?? 0) > 1;

  const openEpReorder = () => {
    setEpOrder(episodes ?? []);
    setEpDirty(false);
    setEpMode(true);
  };

  // Persist an episode order (shared by the inline drag + the dedicated mode).
  const persistEpisodeOrder = useCallback(
    (ids: string[]) => {
      setEpSaving(true);
      return fetch("/api/file-series", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reorder", fileSeriesId: series.fileSeriesId, episodeIds: ids }),
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("save failed"))))
        .catch(() => load()) // resync from server on failure
        .finally(() => setEpSaving(false));
    },
    [series.fileSeriesId, load],
  );

  // Inline: grab an episode by its header and drop it — saves immediately.
  const onEpisodeInlineDragEnd = (e: DragEndEvent) => {
    if (!episodes) return;
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = episodes.findIndex((x) => x.episodeId === active.id);
    const to = episodes.findIndex((x) => x.episodeId === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(episodes, from, to);
    setEpisodes(next);
    void persistEpisodeOrder(next.map((x) => x.episodeId));
  };

  const onEpDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setEpOrder((prev) => {
      const from = prev.findIndex((x) => x.episodeId === active.id);
      const to = prev.findIndex((x) => x.episodeId === over.id);
      if (from < 0 || to < 0) return prev;
      return arrayMove(prev, from, to);
    });
    setEpDirty(true);
  };

  const saveEpOrder = () => {
    setEpSaving(true);
    fetch("/api/file-series", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reorder",
        fileSeriesId: series.fileSeriesId,
        episodeIds: epOrder.map((e) => e.episodeId),
      }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("save failed"))))
      .then(() => load())
      .catch(() => {})
      .finally(() => setEpSaving(false));
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card/30">
      <div className="flex items-center gap-3 px-3 py-3">
        <button
          type="button"
          onClick={toggle}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{series.title}</p>
            <p className="text-xs text-muted-foreground">
              {series.episodeCount} {series.episodeCount === 1 ? "episode" : "episodes"}
            </p>
          </div>
        </button>
        {series.mainUniqueId ? (
          <Button asChild variant="ghost" size="sm" className="shrink-0 gap-1.5">
            <Link to={`/${encodeURIComponent(series.mainUniqueId)}`}>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden sm:inline">Open</span>
            </Link>
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="space-y-4 border-t border-border/50 px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button size="sm" variant="secondary" className="rounded-full" onClick={() => setAddTarget({})}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              Add video
            </Button>
            {multiEpisode && !epMode ? (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto rounded-full text-muted-foreground"
                onClick={openEpReorder}
              >
                <ListOrdered className="mr-1.5 h-4 w-4" aria-hidden />
                Reorder episodes
              </Button>
            ) : null}
          </div>

          {status === "loading" ? (
            <div className="h-24 animate-pulse rounded-lg border border-border/60 bg-muted/25" aria-busy />
          ) : status === "error" ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Couldn’t load videos.{" "}
              <button className="underline" onClick={load} type="button">
                Retry
              </button>
            </p>
          ) : epMode ? (
            <div className="space-y-2">
              <p className="px-1 text-xs text-muted-foreground">Drag episodes to set their order.</p>
              <DndContext sensors={epSensors} collisionDetection={closestCenter} onDragEnd={onEpDragEnd}>
                <SortableContext
                  items={epOrder.map((e) => e.episodeId)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="flex flex-col gap-1.5">
                    {epOrder.map((ep, i) => (
                      <SortableEpisodeName key={ep.episodeId} ep={ep} index={i} />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
              <div className="flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  disabled={epSaving}
                  onClick={() => setEpMode(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="rounded-full"
                  disabled={!epDirty || epSaving}
                  onClick={saveEpOrder}
                >
                  {epSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
                  Save order
                </Button>
              </div>
            </div>
          ) : !episodes || episodes.every((e) => e.items.length === 0) ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No videos in this series yet — use “Add video”.
            </p>
          ) : multiEpisode ? (
            <>
              <p className="px-1 text-xs text-muted-foreground">
                Drag an episode by its handle to move it (its videos go with it). Drag a video to
                reorder it within its episode.
              </p>
              <DndContext
                sensors={epSensors}
                collisionDetection={closestCenter}
                onDragEnd={onEpisodeInlineDragEnd}
              >
                <SortableContext
                  items={episodes.map((e) => e.episodeId)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="flex flex-col gap-2">
                    {episodes.map((ep) => (
                      <DraggableEpisode
                        key={ep.episodeId}
                        fileSeriesId={series.fileSeriesId}
                        episode={ep}
                        currentUserId={currentUserId}
                        onAdd={() => setAddTarget({ episodeId: ep.episodeId, episodeName: ep.episodeName })}
                        onChanged={load}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
              {epSaving ? (
                <p className="text-right text-xs text-muted-foreground">Saving…</p>
              ) : null}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="px-1 text-xs text-muted-foreground">
                  Drag videos by their handle to set the play order, then save.
                </p>
                {episodes[0] ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 gap-1 rounded-full px-2 text-xs"
                    onClick={() =>
                      setAddTarget({
                        episodeId: episodes[0].episodeId,
                        episodeName: episodes[0].episodeName,
                      })
                    }
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    Add to episode
                  </Button>
                ) : null}
              </div>
              {episodes.map((ep) => (
                <EpisodeBlock
                  key={ep.episodeId}
                  fileSeriesId={series.fileSeriesId}
                  episode={ep}
                  showHeader={false}
                  currentUserId={currentUserId}
                  onChanged={load}
                />
              ))}
            </>
          )}
        </div>
      ) : null}

      {currentUserId ? (
        <AddFileDialog
          open={addTarget !== null}
          onOpenChange={(o) => setAddTarget(o ? addTarget ?? {} : null)}
          fileSeriesId={series.fileSeriesId}
          ownerId={currentUserId}
          episodeId={addTarget?.episodeId}
          episodeName={addTarget?.episodeName}
          onAdded={load}
        />
      ) : null}
    </div>
  );
}

export default function StudioSeriesPage() {
  const { userId } = useFileContext();
  const [series, setSeries] = useState<SeriesSummary[] | null>(null);
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/studio/series", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { series?: SeriesSummary[] } | null) => {
        if (cancelled) return;
        setSeries(Array.isArray(j?.series) ? j!.series! : []);
        setStatus("done");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border/60 pb-3">
        <h1 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">Series</h1>
        <p className="text-xs text-muted-foreground sm:text-sm">
          Add videos and arrange the order of each series.
        </p>
      </div>

      {status === "loading" ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl border border-border/60 bg-muted/20" />
          ))}
        </div>
      ) : status === "error" ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Couldn’t load your series.</p>
      ) : series && series.length > 0 ? (
        <div className="space-y-2.5">
          {series.map((s) => (
            <SeriesCard key={s.fileSeriesId} series={s} currentUserId={userId ?? undefined} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border/60 px-4 py-12 text-center">
          <p className="text-sm font-medium text-foreground">No series yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Turn a video into a series from its menu, then come back here to arrange the videos.
          </p>
        </div>
      )}
    </section>
  );
}
