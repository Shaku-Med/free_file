import { useLayoutEffect, useRef, useState } from "react";
import { FormattedText } from "~/components/FormattedText";
import OwnerProfile from "~/components/OwnerProfile/OwnerProfile";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerOverlay,
  DrawerTitle,
} from "~/components/ui/drawer";
import { formatTimeAgo } from "~/lib/formatTimeAgo";
import { formatNumber } from "~/lib/utils/formatNumber";
import ParseFilenameInsert from "~/lib/utils/ShowFileName";
import type { FileType } from "~/lib/types";
import type { VerticalFeedItemData } from "~/components/vertical-feed";

export interface ReelMetaPanelProps {
  file: FileType;
  item: VerticalFeedItemData;
  views: number;
}

function ReelCaptionPreview({
  caption,
  onSeeMore,
}: {
  caption: string;
  onSeeMore: () => void;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useLayoutEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const check = () => setIsTruncated(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [caption]);

  return (
    <div className="flex min-w-0 items-end gap-1.5">
      <div
        ref={previewRef}
        className="line-clamp-1 min-w-0 flex-1 text-sm leading-snug text-white/90 [text-shadow:0_1px_3px_rgba(0,0,0,0.85)]"
      >
        <FormattedText text={caption} className="text-white/90 [&_a]:text-white" />
      </div>
      {isTruncated ? (
        <button
          type="button"
          className="swiper-no-swiping shrink-0 text-sm font-semibold text-white/95 underline-offset-2 hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            onSeeMore();
          }}
        >
          See more
        </button>
      ) : null}
    </div>
  );
}

/** Creator, title, caption, and stats for the reel info overlay inside the player. */
export function ReelMetaPanel({ file, item, views }: ReelMetaPanelProps) {
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const caption = item.caption?.trim() ?? "";
  const title = file.file_title?.trim() || file.filename || "";

  return (
    <>
      <div
        className="flex min-w-0 flex-col gap-1.5 text-white"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex min-w-0 items-center gap-2">
          {file.owner?.username ? (
            <OwnerProfile
              owner={file.owner}
              size="sm"
              showUsername
              className="text-white [&_span]:font-semibold [&_span]:text-white hover:text-white [&_span]:hover:text-white"
            />
          ) : (
            <p className="truncate text-sm font-semibold text-white">@{item.username || "…"}</p>
          )}
        </div>

        {title ? (
          <p className="line-clamp-2 text-sm font-semibold leading-snug text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.85)]">
            <ParseFilenameInsert
              filename={title}
              className="[&_a]:text-white [&_a]:underline"
            />
          </p>
        ) : null}

        {caption ? (
          <ReelCaptionPreview caption={caption} onSeeMore={() => setDescriptionOpen(true)} />
        ) : null}

        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-white/80 sm:text-xs">
          <span className="font-medium tabular-nums text-white/95">{formatNumber(views)} views</span>
          {file.created_at ? (
            <>
              <span className="opacity-50" aria-hidden>
                ·
              </span>
              <span>{formatTimeAgo(file.created_at)}</span>
            </>
          ) : null}
        </div>
      </div>

      {caption ? (
        <Drawer open={descriptionOpen} onOpenChange={setDescriptionOpen} direction="bottom">
          <DrawerOverlay className="bg-black/40" />
          <DrawerContent
            className="flex max-h-[min(70dvh,520px)] flex-col gap-0 overflow-hidden p-0 data-[vaul-drawer-direction=bottom]:inset-x-0 data-[vaul-drawer-direction=bottom]:mx-auto data-[vaul-drawer-direction=bottom]:w-full data-[vaul-drawer-direction=bottom]:max-w-lg data-[vaul-drawer-direction=bottom]:rounded-t-2xl data-[vaul-drawer-direction=bottom]:border-t data-[vaul-drawer-direction=bottom]:border-border"
            onClick={(e) => e.stopPropagation()}
          >
            <DrawerHeader className="shrink-0 border-b px-4 py-3 text-left">
              <DrawerTitle className="text-base">Description</DrawerTitle>
              {file.owner?.username ? (
                <p className="mt-1 text-sm text-muted-foreground">@{file.owner.username}</p>
              ) : null}
            </DrawerHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {title ? (
                <p className="mb-3 text-sm font-semibold leading-snug text-foreground">
                  <ParseFilenameInsert filename={title} />
                </p>
              ) : null}
              <div className="text-sm leading-relaxed text-foreground">
                <FormattedText text={caption} />
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      ) : null}
    </>
  );
}
