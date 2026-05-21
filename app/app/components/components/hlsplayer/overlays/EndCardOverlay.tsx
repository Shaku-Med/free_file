import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "~/lib/utils";
import { usePlayerContext } from "../PlayerContext";
import {
  playerEndUiLayout,
  usePlayerContainerSize,
} from "../hooks/usePlayerContainerSize";
import VideoCard from "~/routes/Home/components/VideoCard";
import type { FileType } from "~/lib/types";

/** Show the cards when remaining playback drops below this many seconds. */
const TRIGGER_REMAINING_SEC = 20;
/** Skip the overlay entirely on videos shorter than this — pointless on reels. */
const MIN_DURATION_SEC = 60;

/** Layout presets — corners stay clear of center picture like YouTube's corner tiles. */
export const END_CARD_LAYOUT_OPTIONS = [
  /**
   * YouTube-style grid: a responsive 2x2 / 1x4 deck of cards floating over
   * the lower half of the player, with a soft top→bottom dim so the cards
   * stand out without hiding the video. Default for new players.
   */
  "grid",
  "4-corners",
  "two-center",
  "4-corners-plus-2-center",
  "bottom-corners",
  /** Thin floating chips above controls (no full-width slab). */
  "bottom-row",
] as const;

export type EndCardLayout = (typeof END_CARD_LAYOUT_OPTIONS)[number];

interface EndCardOverlayProps {
  /** Defaults to `'4-corners'` — least intrusive. */
  layout?: EndCardLayout;
  /**
   * UUIDs of files the surrounding page is already showing in its related /
   * up-next rails. Forwarded to the RPC as `p_exclude_ids` so the end-card
   * panel always lands on a *distinct* slice instead of duplicating cards
   * the viewer already sees on the page.
   */
  excludeIds?: string[];
}

interface Suggestion {
  id: string;
  unique_id: string;
  file_title: string | null;
  filename: string | null;
  default_thumbnail: string | null;
  duration: number | null;
  view_count: number | null;
  is_reel: boolean | null;
  is_adult: boolean | null;
  is_public: boolean | null;
  created_at: string | null;
  owner_id: string | null;
  owner_username: string | null;
  owner_profile_pic: string | null;
  owner_verified: boolean | null;
}

function toFileType(s: Suggestion): FileType {
  return {
    id: s.id,
    unique_id: s.unique_id,
    file_title: s.file_title ?? undefined,
    filename: s.filename ?? "",
    default_thumbnail: s.default_thumbnail ?? null,
    duration: typeof s.duration === "number" ? s.duration : undefined,
    view_count: typeof s.view_count === "number" ? s.view_count : 0,
    is_reel: Boolean(s.is_reel),
    is_adult: Boolean(s.is_adult),
    is_public: s.is_public !== false,
    created_at: s.created_at ?? undefined,
    owner: s.owner_username
      ? {
          id: s.owner_id ?? "",
          username: s.owner_username,
          profile_pic: s.owner_profile_pic ?? null,
          verified: Boolean(s.owner_verified),
        }
      : undefined,
  } as FileType;
}

/**
 * Safe-area aware placement so tiles stay clear of notched screens and of the ControlBar /
 * seek stack (especially tall mobile layouts).
 */
const SAFE_TOP = "top-[max(0.5rem,env(safe-area-inset-top,0px))]";
const SAFE_LEFT = "left-[max(0.5rem,env(safe-area-inset-left,0px))]";
const SAFE_RIGHT = "right-[max(0.5rem,env(safe-area-inset-right,0px))]";

function slotWidthClass(playerW: number, maxPct: number, minRem: number, maxRem: number) {
  if (playerW <= 0) {
    return `w-[clamp(${minRem}rem,min(26vw,22%),${maxRem}rem)]`;
  }
  const capPx = Math.round(playerW * maxPct);
  return `w-[clamp(${minRem}rem,${capPx}px,${maxRem}rem)]`;
}

/**
 * Slot positioning per layout. Each slot is one absolutely-positioned wrapper
 * around a single card. Widths use `clamp` so on tiny players (e.g. mini) they
 * never balloon past ~30% of the player width; on big players they cap at the
 * `max` so they don't look gigantic.
 */
type SlotClassName = string;

function layoutSlots(playerW: number, controlsBottom: string): Record<
  Exclude<EndCardLayout, "bottom-row" | "grid">,
  SlotClassName[]
> {
  const cornerW = slotWidthClass(playerW, 0.22, 7.25, 11);
  const centerW = slotWidthClass(playerW, 0.26, 7.25, 12);
  const tightCornerW = slotWidthClass(playerW, 0.2, 7, 10.5);
  const tightCenterW = slotWidthClass(playerW, 0.2, 7, 10.5);
  const bottomW = slotWidthClass(playerW, 0.26, 7.5, 12);

  return {
    "4-corners": [
      cn("absolute z-[2]", cornerW, SAFE_TOP, SAFE_LEFT),
      cn("absolute z-[2]", cornerW, SAFE_TOP, SAFE_RIGHT),
      cn("absolute z-[2]", cornerW, controlsBottom, SAFE_LEFT),
      cn("absolute z-[2]", cornerW, controlsBottom, SAFE_RIGHT),
    ],
    "two-center": [
      cn("absolute left-1/2 z-[2] -translate-x-1/2", centerW, SAFE_TOP),
      cn("absolute left-1/2 z-[2] -translate-x-1/2", centerW, controlsBottom),
    ],
    "4-corners-plus-2-center": [
      cn("absolute z-[2]", tightCornerW, SAFE_TOP, SAFE_LEFT),
      cn("absolute z-[2]", tightCornerW, SAFE_TOP, SAFE_RIGHT),
      cn("absolute left-1/2 z-[2] -translate-x-1/2", tightCenterW, SAFE_TOP),
      cn("absolute z-[2]", tightCornerW, controlsBottom, SAFE_LEFT),
      cn("absolute z-[2]", tightCornerW, controlsBottom, SAFE_RIGHT),
      cn("absolute left-1/2 z-[2] -translate-x-1/2", tightCenterW, controlsBottom),
    ],
    "bottom-corners": [
      cn("absolute z-[2]", bottomW, controlsBottom, SAFE_LEFT),
      cn("absolute z-[2]", bottomW, controlsBottom, SAFE_RIGHT),
    ],
  };
}

const CARD_CAP: Record<EndCardLayout, number> = {
  "grid": 4,
  "4-corners": 4,
  "two-center": 2,
  "4-corners-plus-2-center": 6,
  "bottom-row": 4,
  "bottom-corners": 2,
};

export default function EndCardOverlay({
  layout = "grid",
  excludeIds,
}: EndCardOverlayProps = {}) {
  const { state, file, isReel, containerRef } = usePlayerContext();
  const { width: playerW, height: playerH } = usePlayerContainerSize(containerRef);
  const ui = playerEndUiLayout(playerW, playerH);
  const controlsBottom = `bottom-[max(${ui.controlsClearancePx}px,calc(4rem+env(safe-area-inset-bottom,0px)))]`;
  const layoutSlotsForPlayer = useMemo(
    () => layoutSlots(playerW, controlsBottom),
    [playerW, ui.controlsClearancePx],
  );
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const fetchedForFileRef = useRef<string | null>(null);

  const fileId = typeof file?.id === "string" ? file.id : "";
  /**
   * Stable signature of the exclusion list — guards the lazy-fetch effect so a
   * new reference for an *unchanged* set of IDs doesn't kick off a re-fetch.
   */
  const excludeKey = useMemo(() => {
    if (!excludeIds || excludeIds.length === 0) return "";
    const clean = excludeIds.filter((id) => typeof id === "string" && id.length > 0);
    return clean.slice().sort().join(",");
  }, [excludeIds]);
  const durationOk = state.duration >= MIN_DURATION_SEC;
  const remaining = state.duration > 0 ? state.duration - state.currentTime : Infinity;
  const active =
    !state.isEnded &&
    durationOk &&
    !isReel &&
    !dismissed &&
    remaining > 0 &&
    remaining <= TRIGGER_REMAINING_SEC &&
    Boolean(fileId);

  // Reset on file change so we re-fetch fresh suggestions and don't show stale
  // cards from the previous video.
  useEffect(() => {
    setDismissed(false);
    setSuggestions([]);
    fetchedForFileRef.current = null;
  }, [fileId]);

  // Lazy fetch — first time the overlay would render for this file, grab the
  // suggestions. Cached server-side, cached browser-side by the response's
  // Cache-Control: private, max-age=60.
  useEffect(() => {
    if (!active) return;
    if (!fileId) return;
    const cap = CARD_CAP[layout];
    const cacheKey = `${fileId}::${excludeKey}::${cap}`;
    if (fetchedForFileRef.current === cacheKey) return;
    fetchedForFileRef.current = cacheKey;
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({
          file_id: fileId,
          limit: String(cap),
        });
        if (excludeKey) params.set("exclude_ids", excludeKey);
        const res = await fetch(`/api/endcards?${params.toString()}`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const json = (await res.json()) as { suggestions?: Suggestion[] };
        if (cancelled) return;
        setSuggestions(Array.isArray(json.suggestions) ? json.suggestions : []);
      } catch {
        /* offline / aborted — fail silently, nothing to show */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, fileId, excludeKey, layout]);

  const cards = useMemo(() => {
    const mapped = suggestions.slice(0, CARD_CAP[layout]).map(toFileType);
    return mapped.filter((c) => !c.is_reel);
  }, [suggestions, layout]);

  if (!active || cards.length === 0) return null;

  const dismissBtn = (
    <button
      type="button"
      onClick={() => setDismissed(true)}
      className={cn(
        "pointer-events-auto absolute z-[5] flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white/85 ring-1 ring-white/15 backdrop-blur-sm transition-colors hover:bg-black/75 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
        SAFE_TOP,
        SAFE_RIGHT,
      )}
      aria-label="Dismiss suggestions"
    >
      <X className="h-4 w-4" />
    </button>
  );

  /**
   * YouTube-style grid — soft bottom-half gradient + 2×2 (narrow) or 1×4
   * (wide) deck of recommendation cards. Video keeps playing underneath
   * full-opacity; the gradient just gives the cards readable contrast.
   */
  if (layout === "grid") {
    const gridCols = ui.endCardGridCols;
    const gridClass =
      gridCols === 4
        ? "grid-cols-4 gap-2.5"
        : gridCols === 2
          ? "grid-cols-2 gap-2"
          : "grid-cols-1 gap-2";
    const gridCards = cards.slice(0, gridCols === 1 ? 2 : 4);

    return (
      <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-label="Up next">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 top-[35%] bg-gradient-to-t from-black/80 via-black/55 to-transparent" />

        {dismissBtn}

        <div
          className={cn(
            "pointer-events-none absolute z-[2] flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-white/85 drop-shadow-sm",
            playerW >= 440 && "text-xs",
            SAFE_LEFT,
          )}
          style={{ top: "38%" }}
        >
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          Up next
        </div>

        <div
          className={cn(
            "pointer-events-auto absolute left-1/2 z-[3] min-w-0 max-w-full -translate-x-1/2 grid",
            "w-[min(100%,56rem)] px-1",
            gridClass,
            controlsBottom,
          )}
        >
          {gridCards.map((card, i) => (
            <div
              key={card.id ?? card.unique_id}
              className="min-w-0 max-w-full animate-in fade-in slide-in-from-bottom-2 duration-300"
              style={{ animationDelay: `${i * 60}ms`, animationFillMode: "both" }}
            >
              {/* Slight glassy frame so each card reads against bright
                  video frames even where the scrim is thinnest. */}
              <div className="overflow-hidden rounded-lg bg-black/60 ring-1 ring-white/10 backdrop-blur-sm transition-transform duration-200 hover:scale-[1.02] hover:ring-white/25">
                <VideoCard data={card} layout="endCard" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  /** Floating chips above controls — wide slab avoided so centre stays readable. */
  if (layout === "bottom-row") {
    const chipWidth =
      playerW > 0
        ? slotWidthClass(playerW, playerW < 380 ? 0.42 : 0.33, 6.75, 11)
        : "w-[clamp(6.75rem,min(38vw,33%),11rem)]";

    return (
      <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-label="Up next">
        {dismissBtn}
        <div
          className={cn(
            "pointer-events-none absolute z-[2] flex min-w-0 max-w-full justify-center",
            SAFE_LEFT,
            SAFE_RIGHT,
            controlsBottom,
          )}
        >
          <div className="pointer-events-auto flex max-w-full min-w-0 flex-row flex-wrap justify-center gap-2 px-1">
            {cards.map((card, i) => (
              <div
                key={card.id ?? card.unique_id}
                className={cn(
                  chipWidth,
                  "min-w-0 max-w-full animate-in fade-in slide-in-from-bottom-1 duration-300",
                )}
                style={{ animationDelay: `${i * 60}ms`, animationFillMode: "both" }}
              >
                <div className="rounded-md bg-black/55 ring-1 ring-white/10 backdrop-blur-sm">
                  <VideoCard data={card} layout="endCard" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const slots = layoutSlotsForPlayer[layout];
  return (
    <div className="pointer-events-none absolute inset-0 z-30" aria-label="Up next">
      {dismissBtn}
      {cards.map((card, i) => {
        const slotClass = slots[i] ?? slots[slots.length - 1];
        return (
          <div
            key={card.id ?? card.unique_id}
            className={`${slotClass} pointer-events-auto animate-in fade-in slide-in-from-bottom-1 duration-300`}
            style={{ animationDelay: `${i * 60}ms`, animationFillMode: "both" }}
          >
            <div className="rounded-md bg-black/55 ring-1 ring-white/10 backdrop-blur-sm">
              <VideoCard data={card} layout="endCard" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
