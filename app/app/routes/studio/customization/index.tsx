import { useCallback, useMemo, useState } from "react";
import { data, useLoaderData, type MetaFunction } from "react-router";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import {
  GripVertical,
  Plus,
  X,
  Loader2,
  Check,
  Film,
  Clapperboard,
  TrendingUp,
  ListVideo,
} from "lucide-react";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { normalizeRpcFileRow } from "~/lib/profile/normalizeRpcFileRow";
import { cn } from "~/lib/utils";
import { buildPageMeta } from "~/lib/seo";
import VideoCard from "~/routes/Home/components/VideoCard";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Button } from "~/components/ui/button";
import type { FileType } from "~/lib/types";
import {
  sanitizeChannelLayout,
  DEFAULT_CHANNEL_LAYOUT,
  SECTION_LABELS,
  SECTION_DESCRIPTIONS,
  CHANNEL_SECTION_TYPES,
  MAX_SECTIONS,
  type ChannelLayout,
  type ChannelSection,
  type ChannelSectionType,
} from "~/lib/channel/channelLayout";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Customize profile | Memories",
    description: "Arrange your profile home page.",
    canonicalPath: "/brozystudio/customization",
    noindex: true,
  });

interface ChannelBuckets {
  shorts: FileType[];
  videos: FileType[];
  popular: FileType[];
}

function mapRow(row: unknown): FileType {
  const r = normalizeRpcFileRow(row as Record<string, unknown>) as Record<string, unknown>;
  return {
    ...r,
    like_count: Number(r["like_count"]) || 0,
    dislike_count: Number(r["dislike_count"]) || 0,
    comment_count: Number(r["comment_count"]) || 0,
    owner: r["owner_username"]
      ? {
          id: r["owner_id"] as string,
          username: r["owner_username"] as string,
          profile_pic: (r["owner_profile_pic"] as string) || "",
          verified: (r["owner_verified"] as boolean) || false,
          about: (r["owner_about"] as string | null) ?? null,
        }
      : null,
  } as unknown as FileType;
}

export const loader = async ({ request }: { request: Request }) => {
  const user = await isAuthenticated(request, ["id"]).catch(() => null);
  const empty: ChannelBuckets = { shorts: [], videos: [], popular: [] };
  if (!user?.id || !db) {
    return data({ layout: DEFAULT_CHANNEL_LAYOUT, buckets: empty, playlistCount: 0 });
  }

  const [{ data: userRow }, { data: homeRows }, { data: plRows }] = await Promise.all([
    db.from("users").select("channel_layout").eq("id", user.id).maybeSingle(),
    db.rpc("get_channel_home", { p_profile_user_id: user.id, p_viewer_id: user.id, p_limit: 6 }),
    db.rpc("get_user_playlists", { p_user_id: user.id }),
  ]);

  const layout = userRow?.channel_layout
    ? sanitizeChannelLayout(userRow.channel_layout)
    : DEFAULT_CHANNEL_LAYOUT;

  const buckets: ChannelBuckets = { shorts: [], videos: [], popular: [] };
  if (Array.isArray(homeRows)) {
    for (const row of homeRows) {
      const section = (row as { section?: string }).section;
      const file = mapRow(row);
      if (section === "shorts") buckets.shorts.push(file);
      else if (section === "videos") buckets.videos.push(file);
      else if (section === "popular") buckets.popular.push(file);
    }
  }

  return data({
    layout,
    buckets,
    playlistCount: Array.isArray(plRows) ? plRows.length : 0,
  });
};

const SECTION_ICON: Record<ChannelSectionType, typeof Film> = {
  shorts: Clapperboard,
  videos: Film,
  popular: TrendingUp,
  playlists: ListVideo,
};

/** Live preview strip of what the section shows on the channel. */
function SectionPreview({
  type,
  buckets,
  playlistCount,
}: {
  type: ChannelSectionType;
  buckets: ChannelBuckets;
  playlistCount: number;
}) {
  if (type === "playlists") {
    return (
      <p className="px-1 text-xs text-muted-foreground">
        {playlistCount === 0
          ? "No playlists yet."
          : playlistCount === 1
            ? "1 playlist"
            : `${playlistCount} playlists`}
      </p>
    );
  }

  const files = (type === "shorts" ? buckets.shorts : type === "popular" ? buckets.popular : buckets.videos).slice(
    0,
    4,
  );
  if (files.length === 0) {
    return <p className="px-1 text-xs text-muted-foreground">Nothing to show here yet.</p>;
  }
  const reel = type === "shorts";
  return (
    <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin] sm:gap-4">
      {files.map((file, i) => (
        <div
          key={file.id}
          className={cn(
            "shrink-0",
            reel ? "w-28 sm:w-32" : "w-44 sm:w-52 lg:w-56",
          )}
        >
          <VideoCard
            data={file}
            index={i}
            related
            layout={reel ? "reelStrip" : "shelf"}
            hideActions={{ completely: true }}
          />
        </div>
      ))}
    </div>
  );
}

function SortableSectionRow({
  section,
  buckets,
  playlistCount,
  onToggle,
  onRemove,
}: {
  section: ChannelSection;
  buckets: ChannelBuckets;
  playlistCount: number;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.type,
  });
  const Icon = SECTION_ICON[section.type];
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined,
        transition,
      }}
      className={cn(
        "rounded-2xl border border-border/60 bg-card/30",
        isDragging && "z-10 border-primary/40 bg-card shadow-lg",
      )}
    >
      <div className="flex items-center gap-3 px-3 pt-3.5 sm:px-4">
        <button
          type="button"
          className="cursor-grab touch-none text-muted-foreground/50 hover:text-foreground active:cursor-grabbing"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-5 w-5" />
        </button>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{SECTION_LABELS[section.type]}</p>
          <p className="truncate text-xs text-muted-foreground">{SECTION_DESCRIPTIONS[section.type]}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={section.visible}
          onClick={onToggle}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
            section.visible ? "bg-primary" : "bg-muted-foreground/25",
          )}
        >
          <span
            className={cn(
              "inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
              section.visible ? "translate-x-[18px]" : "translate-x-1",
            )}
          />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${SECTION_LABELS[section.type]}`}
          className="shrink-0 rounded-md p-1 text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className={cn("px-3 pb-3.5 pt-3 sm:px-4", !section.visible && "opacity-50")}>
        <SectionPreview type={section.type} buckets={buckets} playlistCount={playlistCount} />
      </div>
    </div>
  );
}

export default function StudioCustomizationPage() {
  const { layout: initialLayout, buckets, playlistCount } = useLoaderData<typeof loader>();
  const [layout, setLayout] = useState<ChannelLayout>(initialLayout);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const markDirty = useCallback(() => setSaveState("idle"), []);

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      setLayout((prev) => {
        const from = prev.sections.findIndex((s) => s.type === active.id);
        const to = prev.sections.findIndex((s) => s.type === over.id);
        if (from < 0 || to < 0) return prev;
        return { ...prev, sections: arrayMove(prev.sections, from, to) };
      });
      markDirty();
    },
    [markDirty],
  );

  const toggleSection = useCallback(
    (type: ChannelSectionType) => {
      setLayout((prev) => ({
        ...prev,
        sections: prev.sections.map((s) => (s.type === type ? { ...s, visible: !s.visible } : s)),
      }));
      markDirty();
    },
    [markDirty],
  );

  const removeSection = useCallback(
    (type: ChannelSectionType) => {
      setLayout((prev) => ({ ...prev, sections: prev.sections.filter((s) => s.type !== type) }));
      markDirty();
    },
    [markDirty],
  );

  const addSection = useCallback(
    (type: ChannelSectionType) => {
      setLayout((prev) => {
        if (prev.sections.some((s) => s.type === type)) return prev;
        if (prev.sections.length >= MAX_SECTIONS) return prev;
        return { ...prev, sections: [...prev.sections, { type, visible: true }] };
      });
      markDirty();
    },
    [markDirty],
  );

  const missingTypes = useMemo(
    () => CHANNEL_SECTION_TYPES.filter((t) => !layout.sections.some((s) => s.type === t)),
    [layout.sections],
  );

  const save = useCallback(async () => {
    setSaveState("saving");
    try {
      const res = await fetch("/api/channel/layout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(layout),
      });
      if (!res.ok) {
        setSaveState("error");
        return;
      }
      const json = (await res.json().catch(() => null)) as { layout?: ChannelLayout } | null;
      if (json?.layout) setLayout(json.layout);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [layout]);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Customize profile</h1>
          <p className="text-sm text-muted-foreground">
            Drag to arrange how your profile home looks to everyone. Up to {MAX_SECTIONS} sections.
          </p>
        </div>
        <Button onClick={save} disabled={saveState === "saving"} className="gap-1.5">
          {saveState === "saving" && <Loader2 className="h-4 w-4 animate-spin" />}
          {saveState === "saved" && <Check className="h-4 w-4" />}
          {saveState === "saved" ? "Saved" : "Save"}
        </Button>
      </div>

      {saveState === "error" && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Couldn&apos;t save. Try again.
        </p>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Sections</h2>
        {missingTypes.length > 0 && layout.sections.length < MAX_SECTIONS && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" />
                Add section
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {missingTypes.map((t) => (
                <DropdownMenuItem key={t} onSelect={() => addSection(t)}>
                  {SECTION_LABELS[t]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {layout.sections.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border/60 py-10 text-center text-sm text-muted-foreground">
          No sections. Add one to build your channel home.
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={layout.sections.map((s) => s.type)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-3.5 sm:space-y-4">
              {layout.sections.map((section) => (
                <SortableSectionRow
                  key={section.type}
                  section={section}
                  buckets={buckets}
                  playlistCount={playlistCount}
                  onToggle={() => toggleSection(section.type)}
                  onRemove={() => removeSection(section.type)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </section>
  );
}
