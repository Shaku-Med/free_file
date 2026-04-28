import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Link } from "react-router";
import { GripVertical, ListVideo, Lock, RotateCcw, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import type { FileType } from "~/lib/types";
import VideoCard from "~/routes/Home/components/VideoCard";
import { useFileContext } from "~/lib/Context/Context";
import {
  PLAY_QUEUE_DROP_APPEND,
  PLAY_QUEUE_DROP_EMPTY,
  playQueueItemId,
  usePlayQueueOptional,
} from "./PlayQueueContext";

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
        "flex items-stretch gap-2 border-b border-border/50 py-1 pl-1 pr-0 last:border-b-0",
        isDragging && "z-10 rounded-lg bg-card shadow-md ring-1 ring-border"
      )}
    >
      <div className="flex shrink-0 items-start pt-2">
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
          layout="horizontal"
          related
          data={video}
          index={index}
          currentUserId={currentUserId}
          userActions={userActions}
        />
      </div>
      <div className="flex shrink-0 items-start pt-2">
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
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20">
      <div className="border-b border-border/50 px-3 py-2">
        <div className="flex items-start gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Lock className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <ListVideo className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="text-sm font-semibold text-foreground">Play queue</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help text-xs text-muted-foreground underline decoration-dotted">
                    Why locked?
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[240px]">
                  Sign in to edit your play queue.
                </TooltipContent>
              </Tooltip>
            </div>
            <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
              <Link to="/auth/login" className="font-medium text-primary hover:underline">
                Sign in
              </Link>{" "}
              to customize what plays next.
            </p>
          </div>
        </div>
      </div>
      {defaultQueue.length === 0 ? (
        <div className="px-3 py-4 text-center text-xs text-muted-foreground">Nothing queued yet.</div>
      ) : (
        <ul className="max-h-[min(36dvh,240px)] divide-y divide-border/50 overflow-y-auto opacity-80 sm:max-h-[min(40vh,280px)]">
          {defaultQueue.map((video, index) => (
            <li key={video.id} className="py-1">
              <VideoCard
                layout="horizontal"
                related
                data={video}
                index={index}
                currentUserId={currentUserId}
                userActions={userActions}
              />
            </li>
          ))}
        </ul>
      )}
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

  if (!q) return null;

  const { queue, defaultQueue, viewerCanCustomizeQueue, isCustomized, removeAt, resetQueue } = q;

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
        <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <ListVideo className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate text-sm font-semibold text-foreground">Play queue</span>
          </div>
          {isCustomized ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 gap-1 px-2 text-xs"
              onClick={resetQueue}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          ) : null}
        </div>
        <div className="p-2">
          <EmptyQueueDropZone />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 bg-card/40">
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <ListVideo className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate text-sm font-semibold text-foreground">Play queue</span>
          <span className="text-xs text-muted-foreground tabular-nums">({queue.length})</span>
        </div>
        {isCustomized ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 gap-1 px-2 text-xs"
            onClick={resetQueue}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        ) : null}
      </div>
      <div className="flex max-h-[min(36dvh,240px)] flex-col overflow-hidden sm:max-h-[min(40vh,280px)]">
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          <ul className="overflow-y-auto px-1">
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
        <div className="border-t border-border/50 p-1">
          <QueueDropAppend />
        </div>
      </div>
    </div>
  );
}
