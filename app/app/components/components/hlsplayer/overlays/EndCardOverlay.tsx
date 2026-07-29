import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { EyeOff, RotateCcw } from "lucide-react";
import { cn } from "~/lib/utils";
import { usePlayerContext } from "../PlayerContext";
import { usePlayerContainerSize, endCardOverlayLayout } from "../hooks/usePlayerContainerSize";
import VideoCard from "~/routes/Home/components/VideoCard";
import { isMixGid, mixWatchPath } from "~/lib/music/mixId";
import { nextInMix } from "~/lib/music/mixStore";
import type { FileType } from "~/lib/types";

/**
 * EndCardOverlay
 *
 * The single end-of-video surface. Replaces the previous full-screen
 * EndScreen + API-backed mid-video EndCardOverlay. Renders only when
 * the player reports `state.isEnded`. Suggestions come from props the
 * watch page already loads (related + series)  no extra API.
 *
 * Layout: on desktop, two centered horizontal cards side by side; on mobile,
 * a vertical stack or flanking pair depending on player aspect.
 */

const COUNTDOWN_SEC = 5;
const MAX_CARDS = 2;
/** Show the corner cards once playback gets this close to the end. */
const TRIGGER_REMAINING_SEC = 20;
/** Skip the overlay on anything shorter than this (reels, snippets). */
const MIN_DURATION_SEC = 30;

interface EndCardOverlayProps {
  suggestedVideos?: FileType[];
  seriesUpNextVideos?: FileType[];
  /** Reserved for future use  currently unused; VideoCard reads via context. */
  userActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
  currentUserId?: string;
}

const emptyUserActions = {
  likedFileIds: new Set<string>(),
  dislikedFileIds: new Set<string>(),
};

function getVisitedVideos(): Set<string> {
  try {
    if (typeof sessionStorage === "undefined") return new Set();
    const stored = sessionStorage.getItem("visited_videos");
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

function addVisitedVideo(uniqueId: string) {
  try {
    if (typeof sessionStorage === "undefined") return;
    const visited = getVisitedVideos();
    visited.add(uniqueId);
    const arr = Array.from(visited).slice(-50);
    sessionStorage.setItem("visited_videos", JSON.stringify(arr));
  } catch {
    /* ignore */
  }
}

/**
 * Filters that apply to ANY end-card candidate, before the visited gate.
 * Auto-next should ONLY surface long-form videos:
 *   - never reels (they live in /reel and have their own swiper)
 *   - never images / audio / other non-video files
 *   - never the file we're currently watching
 */
function isVideoCandidate(v: FileType): boolean {
  if (!v || v.is_reel) return false;
  const ft = (v.file_type ?? "").toLowerCase();
  const ep = (v.endpoint ?? "").toLowerCase();
  // Allow only if MIME is video/* OR HLS OR endpoint looks like an HLS stream.
  // Anything starting with image/, audio/, application/pdf, etc. is rejected.
  const isVideo =
    ft.startsWith("video/") ||
    ft === "application/vnd.apple.mpegurl" ||
    ep.includes(".m3u8") ||
    ep.includes(".m2u8");
  return isVideo;
}

function pruneList(videos: FileType[], currentVideoId: string | undefined): FileType[] {
  const visited = getVisitedVideos();
  const candidates = videos.filter(
    (v) => v.unique_id !== currentVideoId && isVideoCandidate(v),
  );
  const fresh = candidates.filter((v) => !visited.has(v.unique_id));
  // If every candidate is visited, fall back to the candidate list (still
  // video-only, still not the current video) so the overlay is never empty.
  return fresh.length > 0 ? fresh : candidates;
}

const SAFE_LEFT = "left-[max(0.5rem,env(safe-area-inset-left,0px))]";
const SAFE_RIGHT = "right-[max(0.5rem,env(safe-area-inset-right,0px))]";

function EndCardSlot({
  card,
  index,
  className,
  style,
  variant = "tile",
  countdownActive,
  countdown,
  dashLen,
  onSelect,
  onCancelAutoplay,
}: {
  card: FileType;
  index: number;
  className?: string;
  style?: CSSProperties;
  /** `tile` = legacy square tile. `row` = horizontal card (all layouts now). */
  variant?: "tile" | "row";
  countdownActive: boolean;
  countdown: number;
  dashLen: number;
  onSelect: (video: FileType) => void;
  onCancelAutoplay: () => void;
}) {
  const isFeatured = index === 0;
  return (
    <div
      className={cn(
        className,
        "pointer-events-auto min-h-0 min-w-0 animate-in fade-in slide-in-from-bottom-2 duration-300",
      )}
      style={{
        ...style,
        animationDelay: `${index * 70}ms`,
        animationFillMode: "both",
        containerType: "inline-size",
      }}
    >
      <div
        className={cn(
          "relative h-full w-full overflow-hidden rounded-lg bg-black/60 ring-1 ring-white/10 backdrop-blur-sm transition-transform duration-200 hover:ring-white/30",
          variant === "tile" && "hover:scale-[1.03]",
          variant === "row" && "active:scale-[0.99]",
          isFeatured && countdownActive && "ring-2 ring-primary/70",
        )}
        onClick={() => {
          onCancelAutoplay();
          onSelect(card);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onCancelAutoplay();
            onSelect(card);
          }
        }}
        role="button"
        tabIndex={0}
      >
        <VideoCard
          data={card}
          layout={variant === "row" ? "endCardHorizontal" : "endCard"}
        />

        {isFeatured && countdownActive && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCancelAutoplay();
            }}
            className="absolute right-1.5 top-1.5 z-[3] flex h-9 w-9 items-center justify-center rounded-full transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            aria-label={`Cancel autoplay (${Math.max(0, countdown)} seconds left)`}
            title="Cancel autoplay"
          >
            <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full -rotate-90 pointer-events-none">
              <circle
                cx="18"
                cy="18"
                r="16"
                fill="rgba(0,0,0,0.55)"
                stroke="rgba(255,255,255,0.2)"
                strokeWidth="2"
              />
              <circle
                cx="18"
                cy="18"
                r="16"
                fill="none"
                stroke="currentColor"
                className="text-primary"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={`${dashLen}, 100.5`}
                style={{ transition: "stroke-dasharray 1s linear" }}
              />
            </svg>
            <span className="relative text-[11px] font-semibold text-white drop-shadow pointer-events-none">
              {Math.max(0, countdown)}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

export default function EndCardOverlay({
  suggestedVideos = [],
  seriesUpNextVideos = [],
  userActions: _userActionsProp,
  currentUserId: _currentUserId,
}: EndCardOverlayProps = {}) {
  // Reserved props consumed via context inside VideoCard; suppress lint.
  void _userActionsProp;
  void _currentUserId;

  const { state, replay, autoPlay, containerRef, authPlaybackFeatures, file, isReel } =
    usePlayerContext();
  const { width: playerW, height: playerH } = usePlayerContainerSize(containerRef);
  const layout = useMemo(
    () => endCardOverlayLayout(playerW, playerH),
    [playerW, playerH],
  );
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const currentVideoId = file?.unique_id ?? params.uniqueId ?? params.id;

  const [countdown, setCountdown] = useState(COUNTDOWN_SEC);
  const [autoplayActive, setAutoplayActive] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const navigatingRef = useRef(false);

  // Series first, then related  series episodes win the featured slot.
  const seriesQueue = useMemo(
    () => pruneList(seriesUpNextVideos, currentVideoId),
    [seriesUpNextVideos, currentVideoId],
  );
  const relatedQueue = useMemo(
    () => pruneList(suggestedVideos, currentVideoId),
    [suggestedVideos, currentVideoId],
  );
  const merged = useMemo(() => {
    const seen = new Set<string>();
    const out: FileType[] = [];
    for (const v of [...seriesQueue, ...relatedQueue]) {
      if (!v?.unique_id || seen.has(v.unique_id)) continue;
      seen.add(v.unique_id);
      out.push(v);
      if (out.length >= MAX_CARDS) break;
    }
    return out;
  }, [seriesQueue, relatedQueue]);

  const nextVideo = merged[0] ?? null;

  // Reset visual + autoplay state on every file change
  // starts with a fresh countdown and re-armed autoplay.
  //
  // NOTE: navigatingRef is INTENTIONALLY not reset here. If we cleared it
  // synchronously, the same render commit would see countdown=0 (queued
  // setCountdown hasn't applied yet) + navigatingRef=false + nextVideo
  // pointing at a NEW suggestion → the countdown effect would fire
  // handleNavigate again, double-navigating past the video we just
  // landed on. We let the isEnded→false reset clear navigatingRef when
  // the new video actually starts playing  by then all state is sane.
  useEffect(() => {
    setCountdown(COUNTDOWN_SEC);
    setAutoplayActive(true);
    setDismissed(false);
  }, [currentVideoId]);

  // When the new video begins playing (isEnded flips false), clear the
  // navigation lock and re-arm everything. This is the single source of
  // truth for "we're ready to auto-next again".
  useEffect(() => {
    if (!state.isEnded) {
      setCountdown(COUNTDOWN_SEC);
      setAutoplayActive(true);
      navigatingRef.current = false;
    }
  }, [state.isEnded]);

  const handleNavigate = useCallback(
    (video: FileType) => {
      if (navigatingRef.current) return;
      navigatingRef.current = true;
      addVisitedVideo(video.unique_id);
      if (location.pathname.startsWith("/reel/")) {
        navigate(`/reel/${video.unique_id}`);
        return;
      }
      // Staying inside a mix: carry the list id and advance the 1-based index,
      // so auto-play doesn't silently drop the viewer out of the list they
      // were in (and the URL still says where in the mix they are).
      const gid = new URLSearchParams(location.search).get("list") ?? "";
      if (isMixGid(gid)) {
        const found = nextInMix(gid, String(file?.unique_id ?? ""));
        const index =
          found && String(found.item.unique_id) === String(video.unique_id)
            ? found.index
            : undefined;
        navigate(mixWatchPath(String(video.unique_id), gid, { index }));
        return;
      }
      navigate(`/${video.unique_id}`);
    },
    [navigate, location.pathname, location.search, file?.unique_id],
  );

  const cancelAutoplay = useCallback(() => {
    setAutoplayActive(false);
    setCountdown(COUNTDOWN_SEC);
  }, []);

  // Auto-next countdown  ONLY runs after the video has fully ended.
  // While the video is still playing (near-end preview), the cards are
  // visible but the countdown stays parked at COUNTDOWN_SEC so the user
  // can pick any card without time pressure.
  useEffect(() => {
    if (
      !state.isEnded ||
      !autoPlay ||
      !autoplayActive ||
      !nextVideo ||
      navigatingRef.current ||
      !authPlaybackFeatures ||
      dismissed
    ) {
      return;
    }
    if (countdown <= 0) {
      handleNavigate(nextVideo);
      return;
    }
    const t = window.setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [
    state.isEnded,
    autoPlay,
    autoplayActive,
    nextVideo,
    countdown,
    authPlaybackFeatures,
    dismissed,
    handleNavigate,
  ]);

  // Visibility logic:
  //   - Long-form video AND in the last TRIGGER_REMAINING_SEC seconds → show cards
  //   - Video has ended → show cards + countdown
  // Reels / very short clips never show the overlay (it'd cover the whole frame).
  const durationOk = state.duration >= MIN_DURATION_SEC;
  const remaining = state.duration > 0 ? state.duration - state.currentTime : Infinity;
  const nearEnd =
    durationOk && remaining > 0 && remaining <= TRIGGER_REMAINING_SEC;
  const shouldShow =
    !isReel &&
    !dismissed &&
    merged.length > 0 &&
    playerW > 48 &&
    playerH > 48 &&
    (state.isEnded || nearEnd);

  if (!shouldShow) {
    return null;
  }

  const cards = merged.slice(0, layout.maxCards);
  const countdownActive =
    state.isEnded &&
    autoPlay &&
    autoplayActive &&
    Boolean(nextVideo) &&
    authPlaybackFeatures;
  const dashLen = Math.max(0, Math.min(100.5, (countdown / COUNTDOWN_SEC) * 100.5));

  const cardProps = {
    countdownActive,
    countdown,
    dashLen,
    onSelect: handleNavigate,
    onCancelAutoplay: cancelAutoplay,
  };

  const dismissTopPx = layout.isMobile ? layout.insetTopPx : layout.insetTopPx + 4;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 flex flex-col overflow-hidden"
      aria-label="Up next"
    >
      {state.isEnded && (
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-black/20 to-black/50" />
      )}

      {/* Top bar: dismiss + optional autoplay cancel */}
      <div
        className="pointer-events-none relative z-[5] flex shrink-0 items-start justify-between gap-2 px-2 sm:px-3"
        style={{ paddingTop: Math.max(8, layout.insetTopPx - 36) }}
      >
        {countdownActive && nextVideo ? (
          <button
            type="button"
            onClick={cancelAutoplay}
            className="pointer-events-auto flex min-w-0 max-w-[min(70%,18rem)] items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white ring-1 ring-white/20 backdrop-blur-md transition-colors hover:bg-black/85 hover:ring-white/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:px-4 sm:py-2 sm:text-sm"
            aria-label="Cancel autoplay"
          >
            <span className="truncate text-white/90">
              Up next in {Math.max(0, countdown)}s
            </span>
            <span className="shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white sm:text-[11px]">
              Cancel
            </span>
          </button>
        ) : (
          <span aria-hidden className="h-9 w-9 shrink-0" />
        )}

        {/* YouTube-style "Hide" pill rather than a bare X — it reads as an
            action and matches the end-screen reference. */}
        <button
          type="button"
          onClick={() => {
            cancelAutoplay();
            setDismissed(true);
          }}
          className="pointer-events-auto flex shrink-0 items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-[13px] font-medium text-black shadow-sm ring-1 ring-black/10 backdrop-blur-sm transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:px-3.5 sm:py-2"
          aria-label="Hide suggestions"
        >
          <EyeOff className="h-4 w-4" />
          <span>Hide</span>
        </button>
      </div>

      {layout.variant === "stack" && (
        <div
          className="pointer-events-none relative z-[2] flex min-h-0 flex-1 flex-col items-center justify-end gap-2 px-2"
          style={{ paddingBottom: layout.insetBottomPx }}
        >
          {state.isEnded && (
            <button
              type="button"
              onClick={() => {
                cancelAutoplay();
                replay();
              }}
              className="pointer-events-auto mb-1 flex items-center gap-1.5 rounded-full bg-black/65 px-3 py-2 text-xs font-medium text-white ring-1 ring-white/20 backdrop-blur-md transition-all hover:bg-black/80 hover:ring-white/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm"
              aria-label="Replay video"
            >
              <RotateCcw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              Replay
            </button>
          )}

          {[...cards].reverse().map((card, i) => (
            <EndCardSlot
              key={card.id ?? card.unique_id}
              card={card}
              index={cards.length - 1 - i}
              variant="row"
              className="pointer-events-auto w-full max-w-full shrink-0"
              style={{
                width: layout.cardWidthPx,
                height: layout.cardHeightPx,
                maxWidth: "100%",
              }}
              {...cardProps}
            />
          ))}
        </div>
      )}

      {layout.variant === "sideBySide" && (
        <>
          {/* YouTube landscape-phone end screen  two horizontal cards
              flanking a center column reserved for the replay button.
              Cards are vertically centered between the top control row
              and the bottom progress bar, so they CAN'T overlap the HD /
              PiP / theater / settings icons (the bug the user reported). */}
          {cards.slice(0, 2).map((card, i) => (
            <EndCardSlot
              key={card.id ?? card.unique_id}
              card={card}
              index={i}
              variant="row"
              className={cn(
                // Top-anchored, matching the YouTube end screen, instead of
                // vertically centered over the middle of the frame.
                "absolute z-[2]",
                i === 0 ? SAFE_LEFT : SAFE_RIGHT,
              )}
              style={{
                width: layout.cardWidthPx,
                height: layout.cardHeightPx,
                // Sit just below the top control row rather than mid-frame.
                top: layout.insetTopPx + 8,
              }}
              {...cardProps}
            />
          ))}

          {state.isEnded && (
            <button
              type="button"
              onClick={() => {
                cancelAutoplay();
                replay();
              }}
              className="pointer-events-auto absolute left-1/2 top-1/2 z-[4] flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full bg-black/65 px-3 py-2 text-xs font-medium text-white ring-1 ring-white/20 backdrop-blur-md transition-all hover:bg-black/80 hover:ring-white/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm"
              aria-label="Replay video"
            >
              <RotateCcw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              Replay
            </button>
          )}
        </>
      )}

      {layout.variant === "centerPair" && (
        // Cards ride at the TOP of the frame (YouTube's end screen), leaving the
        // lower half of the video visible instead of covering it.
        <div
          className="pointer-events-none relative z-[2] flex min-h-0 flex-1 flex-col items-center justify-start px-3 pt-1"
          style={{
            paddingBottom: layout.insetBottomPx,
            gap: layout.cardGapPx + 10,
          }}
        >
          <div
            className="flex w-full max-w-full flex-wrap items-stretch justify-center"
            style={{ gap: layout.cardGapPx }}
          >
            {cards.slice(0, 2).map((card, i) => (
              <EndCardSlot
                key={card.id ?? card.unique_id}
                card={card}
                index={i}
                variant="row"
                className="pointer-events-auto min-w-0 shrink-0"
                style={{
                  width: layout.cardWidthPx,
                  height: layout.cardHeightPx,
                  maxWidth: `calc(50% - ${layout.cardGapPx / 2}px)`,
                  flex: "1 1 240px",
                }}
                {...cardProps}
              />
            ))}
          </div>

          {state.isEnded && (
            <button
              type="button"
              onClick={() => {
                cancelAutoplay();
                replay();
              }}
              className="pointer-events-auto flex items-center gap-2 rounded-full bg-black/65 px-4 py-2.5 text-sm font-medium text-white ring-1 ring-white/20 backdrop-blur-md transition-all hover:bg-black/80 hover:ring-white/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              aria-label="Replay video"
            >
              <RotateCcw className="h-4 w-4" />
              Replay
            </button>
          )}
        </div>
      )}
    </div>
  );
}
