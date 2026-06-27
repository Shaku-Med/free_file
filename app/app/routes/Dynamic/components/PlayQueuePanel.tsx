import { usePersistentToggle } from "~/lib/hooks/usePersistentToggle";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Link } from "react-router";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  ListVideo,
  Lock,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import type { FileType } from "~/lib/types";
import VideoCard from "~/routes/Home/components/VideoCard";
import { useFileContext } from "~/lib/Context/Context";
import { useAuthHrefs } from "~/lib/loginRedirect";
import {
  PLAY_QUEUE_DROP_APPEND,
  PLAY_QUEUE_DROP_EMPTY,
  playQueueItemId,
  usePlayQueueOptional,
} from "./PlayQueueContext";

/** Match `SeriesEpisodesSection` scroll shell so sidebar queue + series cap the same way. */
const PLAY_QUEUE_MAX_HEIGHT =
  "max-h-[calc(100svh-9rem-env(safe-area-inset-bottom,0px))] sm:max-h-[calc(100svh-8rem-env(safe-area-inset-bottom,0px))]";

const PLAY_QUEUE_SCROLL_BODY =
  "min-h-0 overflow-y-auto overscroll-auto [scrollbar-gutter:stable]";

function QueuePanelHeader({
  count,
  isCustomized,
  collapsed,
  onToggleCollapsed,
  onReset,
  onRefresh,
  refreshing,
}: {
  count?: number;
  isCustomized?: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onReset?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
      >
        <ListVideo className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate text-sm font-semibold text-foreground">Play queue</span>
        {typeof count === "number" ? (
          <span className="text-xs text-muted-foreground tabular-nums">({count})</span>
        ) : null}
        {collapsed ? (
          <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronUp className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </button>
      <div className="flex shrink-0 items-center gap-0.5">
        {onRefresh ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh play queue"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          </Button>
        ) : null}
        {isCustomized && onReset ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 gap-1 px-2 text-xs"
            onClick={onReset}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function QueueDropAppend() {
  const { setNodeRef, isOver } = useDroppable({ id: PLAY_QUEUE_DROP_APPEND });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-8 shrink-0 items-center justify-center rounded-md border border-dashed px-1 text-[10px] leading-tight text-muted-foreground transition-colors sm:text-[11px]",
        isOver ? "border-primary bg-primary/10 text-primary" : "border-transparent bg-muted/30"
      )}
    >
      <span className="sm:hidden">Drop at end</span>
      <span className="hidden sm:inline">Drop here for end of queue</span>
    </div>
  );
}

function SortableQueueRow({
  video,
  index,
  onRemove,
  currentUserId,
  userActions,
}: {
  video: FileType;
  index: number;
  onRemove: () => void;
  currentUserId?: string;
  userActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: playQueueItemId(video.id),
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex min-w-0 list-none items-stretch gap-1.5 border-b border-border/40 py-1 pl-0.5 pr-0 last:border-b-0",
        isDragging && "z-10 rounded-lg bg-card shadow-md ring-1 ring-border"
      )}
    >
      <div className="flex shrink-0 items-start pt-1.5">
        <button
          type="button"
          className="flex h-9 w-7 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted active:cursor-grabbing"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder queue"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </div>
      <div className="min-w-0 flex-1">
        <VideoCard
          layout={`compact`}
          related
          hideActions={{completely: false, halfway: true}}
          data={video}
          index={index}
          currentUserId={currentUserId}
          userActions={userActions}
        />
      </div>
      <div className="flex shrink-0 items-start pt-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label="Remove from queue"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );
}

function GuestPlayQueueLocked({
  defaultQueue,
  currentUserId,
  userActions,
}: {
  defaultQueue: FileType[];
  currentUserId?: string;
  userActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
}) {
  const [collapsed, setCollapsed] = usePersistentToggle("memories:playqueue-collapsed", false);
  const { loginHref } = useAuthHrefs();

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20">
      <div className="border-b border-border/50 px-3 py-2">
        <div className="flex items-start gap-2">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-start gap-2 text-left"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Lock className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <ListVideo className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="text-sm font-semibold text-foreground">Play queue</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="cursor-help text-xs text-muted-foreground underline decoration-dotted"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Why locked?
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[240px]">
                    Sign in to edit your play queue.
                  </TooltipContent>
                </Tooltip>
                {collapsed ? (
                  <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronUp className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
                )}
              </div>
              {!collapsed ? (
                <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
                  <Link to={loginHref} className="font-medium text-primary hover:underline">
                    Sign in
                  </Link>{" "}
                  to customize what plays next.
                </p>
              ) : null}
            </div>
          </button>
        </div>
      </div>
      {!collapsed && defaultQueue.length === 0 ? (
        <div className="px-3 py-4 text-center text-xs text-muted-foreground">Nothing queued yet.</div>
      ) : null}
      {!collapsed && defaultQueue.length > 0 ? (
        <div
          className={cn(
            "opacity-80",
            PLAY_QUEUE_MAX_HEIGHT,
            PLAY_QUEUE_SCROLL_BODY,
          )}
        >
          <ul className="m-0 list-none space-y-0 p-2">
            {defaultQueue.map((video, index) => (
              <li
                key={video.id}
                className="min-w-0 border-b border-border/35 py-1.5 last:border-b-0"
              >
                <VideoCard
                  layout={`compact`}
                  related
                  hideActions={{completely: false, halfway: true}}
                  data={video}
                  index={index}
                  currentUserId={currentUserId}
                  userActions={userActions}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function EmptyQueueDropZone() {
  const { setNodeRef, isOver } = useDroppable({ id: PLAY_QUEUE_DROP_EMPTY });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-lg border border-dashed px-3 py-6 text-center text-xs transition-colors",
        isOver ? "border-primary bg-primary/10 text-foreground" : "border-border/80 bg-muted/20 text-muted-foreground"
      )}
    >
      <p className="font-medium text-foreground">Play queue</p>
      <p className="mt-1">Nothing queued after this video.</p>
    </div>
  );
}

export type PlayQueuePanelProps = {
  currentUserId?: string;
  userActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
};

export function PlayQueuePanel({ currentUserId: currentUserIdProp, userActions }: PlayQueuePanelProps) {
  const q = usePlayQueueOptional();
  const { userId: fileUserId } = useFileContext();
  const currentUserId = currentUserIdProp ?? fileUserId ?? undefined;
  const [collapsed, setCollapsed] = usePersistentToggle("memories:playqueue-collapsed", false);

  if (!q) return null;

  const {
    queue,
    defaultQueue,
    viewerCanCustomizeQueue,
    isCustomized,
    removeAt,
    resetQueue,
    refreshQueue,
    queueLoading,
  } = q;

  if (!viewerCanCustomizeQueue) {
    return (
      <GuestPlayQueueLocked
        defaultQueue={defaultQueue}
        currentUserId={currentUserId}
        userActions={userActions}
      />
    );
  }

  const sortableIds = queue.map((v) => playQueueItemId(v.id));

  if (queue.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-card/40">
        <QueuePanelHeader
          isCustomized={isCustomized}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((c) => !c)}
          onReset={resetQueue}
          onRefresh={refreshQueue}
          refreshing={queueLoading}
        />
        {!collapsed ? (
          <div className="p-2">
            <EmptyQueueDropZone />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 bg-card/40">
      <QueuePanelHeader
        count={queue.length}
        isCustomized={isCustomized}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        onReset={resetQueue}
        onRefresh={refreshQueue}
        refreshing={queueLoading}
      />
      {!collapsed ? (
        <div
          className={cn(
            "flex min-h-0 flex-col overflow-hidden",
            PLAY_QUEUE_MAX_HEIGHT,
          )}
        >
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            <ul
              className={cn(
                "m-0 min-h-0 flex-1 list-none space-y-0 px-1 pb-1",
                PLAY_QUEUE_SCROLL_BODY,
              )}
            >
              {queue.map((video, index) => (
                <SortableQueueRow
                  key={video.id}
                  video={video}
                  index={index}
                  onRemove={() => removeAt(index)}
                  currentUserId={currentUserId}
                  userActions={userActions}
                />
              ))}
            </ul>
          </SortableContext>
          <div className="shrink-0 border-t border-border/50 p-1">
            <QueueDropAppend />
          </div>
        </div>
      ) : null}
    </div>
  );
}
