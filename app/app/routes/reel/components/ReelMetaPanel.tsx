import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Music2 } from "lucide-react";
import { FormattedText } from "~/components/FormattedText";
import OwnerProfile from "~/components/OwnerProfile/OwnerProfile";
import SubscribeButton from "~/components/SubscribeButton";
import { FriendLikeBubbles } from "~/routes/reel/components/FriendLikeBubbles";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerOverlay,
  DrawerTitle,
} from "~/components/ui/drawer";
import { useFileContext } from "~/lib/Context/Context";
import { formatTimeAgo } from "~/lib/formatTimeAgo";
import { formatNumber } from "~/lib/utils/formatNumber";
import { formatExactDate } from "~/lib/utils/formatExactDate";
import ParseFilenameInsert from "~/lib/utils/ShowFileName";
import type { FileType } from "~/lib/types";
import type { VerticalFeedItemData } from "~/components/vertical-feed";

export interface ReelMetaPanelProps {
  file: FileType;
  item: VerticalFeedItemData;
  views: number;
}

/**
 * Per-session subscribe-status cache so swiping back to a creator (or revisiting in the
 * feed) doesn't refetch. Keyed by `viewerId:channelId`.
 */
const subStatusCache = new Map<string, boolean>();
const subStatusInflight = new Map<string, Promise<boolean>>();

/**
 * Returns whether the viewer is subscribed to `channelId`:
 * `null` while unknown/loading (so we don't flash a Subscribe button to people who
 * already follow), then `true`/`false`.
 */
function useReelSubscribed(
  channelId: string | undefined,
  userId: string | null | undefined,
): boolean | null {
  const [subscribed, setSubscribed] = useState<boolean | null>(() => {
    if (!channelId || !userId) return false;
    const key = `${userId}:${channelId}`;
    return subStatusCache.has(key) ? subStatusCache.get(key)! : null;
  });

  useEffect(() => {
    if (!channelId || !userId) {
      setSubscribed(false);
      return;
    }
    const key = `${userId}:${channelId}`;
    if (subStatusCache.has(key)) {
      setSubscribed(subStatusCache.get(key)!);
      return;
    }

    let cancelled = false;
    setSubscribed(null);

    let inflight = subStatusInflight.get(key);
    if (!inflight) {
      inflight = fetch(`/api/subscriptions?channel_id=${encodeURIComponent(channelId)}`, {
        credentials: "include",
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const sub = Boolean(d?.success && d.subscribed);
          subStatusCache.set(key, sub);
          return sub;
        })
        .catch(() => false)
        .finally(() => {
          subStatusInflight.delete(key);
        });
      subStatusInflight.set(key, inflight);
    }

    inflight.then((sub) => {
      if (!cancelled) setSubscribed(sub);
    });

    return () => {
      cancelled = true;
    };
  }, [channelId, userId]);

  return subscribed;
}

const CAPTION_PREVIEW_CHARS = 90;

/** Manually broken preview: we clip the text ourselves and append a clickable "…" that opens the drawer. */
function ReelCaptionPreview({
  caption,
  onSeeMore,
}: {
  caption: string;
  onSeeMore: () => void;
}) {
  const firstLine = caption.split(/\r?\n/)[0] ?? "";
  const clipped = firstLine.length > CAPTION_PREVIEW_CHARS;
  const preview = clipped
    ? firstLine.slice(0, CAPTION_PREVIEW_CHARS).replace(/\s+\S*$/, "").trimEnd()
    : firstLine;
  const hasMoreText = clipped || preview.length < caption.length;

  return (
    <div className="min-w-0 text-sm leading-snug text-white/90 [text-shadow:0_1px_3px_rgba(0,0,0,0.85)]">
      <FormattedText text={preview} className="text-white/90 [&_a]:text-white" />
      {hasMoreText ? (
        <button
          type="button"
          aria-label="Show full description"
          className="swiper-no-swiping ml-0.5 align-baseline text-sm font-semibold tracking-widest text-white hover:text-white/75"
          onClick={(e) => {
            e.stopPropagation();
            onSeeMore();
          }}
        >
          …
        </button>
      ) : null}
    </div>
  );
}

/** Creator, title, caption, and stats for the reel info overlay inside the player. */
export function ReelMetaPanel({ file, item, views }: ReelMetaPanelProps) {
  const { userId } = useFileContext();
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const caption = item.caption?.trim() ?? "";
  const title = file.file_title?.trim() || file.filename || "";
  const ownerId = file.owner?.id;
  const isOwner = Boolean(userId && ownerId && userId === ownerId);
  // null = still checking; only surface the button once we know they're NOT subscribed,
  // so already-subscribed viewers never see it (they unsubscribe from the profile).
  const subscribed = useReelSubscribed(ownerId, userId);

  return (
    <>
      <div
        className="flex min-w-0 flex-col gap-1.5 text-white"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Floats above the owner row, Instagram-style. */}
        <FriendLikeBubbles fileId={file.id} viewerId={userId ?? null} enabled={Boolean(userId)} />

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
          {/* Reuse the existing subscribe flow (handles auth, counts, notify).
              Only shown when we've confirmed the viewer is NOT subscribed; once they
              subscribe here it hides itself (`hideWhenSubscribed`). */}
          {ownerId && !isOwner && subscribed === false ? (
            <SubscribeButton
              channelId={ownerId}
              currentUserId={userId ?? null}
              initialSubscribed={false}
              initialNotify={false}
              initialCount={0}
              isOwner={isOwner}
              compact
              hideWhenSubscribed
            />
          ) : null}
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

        {/* Compact stats while folded; the drawer shows full numbers + exact date. */}
        <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-white/80 [text-shadow:0_1px_3px_rgba(0,0,0,0.85)]">
          <span className="tabular-nums">{formatNumber(views)} views</span>
          {file.created_at ? (
            <>
              <span className="opacity-60" aria-hidden>
                ·
              </span>
              <span>{formatTimeAgo(file.created_at)}</span>
            </>
          ) : null}
        </div>

        {/* Sound chip: music icon + the original's title (the action rail's
            audio-art tile carries the thumbnail, Instagram-style). */}
        {(file.original_file_id ||
          (file.metadata as { audio?: { has_audio?: boolean } } | undefined)?.audio?.has_audio) && (
          <Link
            to={`/music/${encodeURIComponent(String(file.original_file_id ?? file.id))}`}
            onClick={(e) => e.stopPropagation()}
            className="swiper-no-swiping inline-flex max-w-[78%] items-center gap-1.5 self-start rounded-full bg-black/45 px-2.5 py-1 text-xs font-medium text-white/95 backdrop-blur-sm transition-colors hover:bg-black/65"
          >
            <Music2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">
              {file.original_sound
                ? file.original_sound.file_title?.trim() ||
                  (file.original_sound.filename || "").replace(/\.[^./\\]+$/, "") ||
                  "Original sound"
                : "Original sound"}
            </span>
          </Link>
        )}
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
              {/* Expanded view: full numbers + exact date (overlay stays uncluttered). */}
              <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                <span className="font-medium tabular-nums text-foreground">
                  {views.toLocaleString("en-US")} views
                </span>
                {file.created_at ? (
                  <>
                    <span className="opacity-50" aria-hidden>
                      ·
                    </span>
                    <span>{formatExactDate(file.created_at)}</span>
                  </>
                ) : null}
              </div>
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
