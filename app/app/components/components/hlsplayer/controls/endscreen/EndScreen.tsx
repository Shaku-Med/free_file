import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Film, RotateCcw, X } from "lucide-react";
import { usePlayerContext } from "../../PlayerContext";
import { usePlayerContainerSize, playerEndUiLayout } from "../../hooks/usePlayerContainerSize";
import type { FileType } from "~/lib/types";
import VideoCard from "~/routes/Home/components/VideoCard";
import { useLocation, useNavigate, useParams } from "react-router";
import { cn } from "~/lib/utils";

interface EndScreenProps {
  suggestedVideos?: FileType[];
  seriesUpNextVideos?: FileType[];
  userActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
  currentUserId?: string;
}

const emptyUserActions = { likedFileIds: new Set<string>(), dislikedFileIds: new Set<string>() };

const getVisitedVideos = (): Set<string> => {
  try {
    if (typeof sessionStorage === "undefined") return new Set();
    const stored = sessionStorage.getItem("visited_videos");
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
};

const addVisitedVideo = (uniqueId: string) => {
  try {
    if (typeof sessionStorage === "undefined") return;
    const visited = getVisitedVideos();
    visited.add(uniqueId);
    const arr = Array.from(visited).slice(-50);
    sessionStorage.setItem("visited_videos", JSON.stringify(arr));
  } catch {}
};

function applyVisitedFilter(videos: FileType[], currentVideoId: string | undefined): FileType[] {
  const filtered = videos.filter((video) => {
    if (currentVideoId && video.unique_id === currentVideoId) return false;
    const visited = getVisitedVideos();
    return !visited.has(video.unique_id);
  });
  if (filtered.length > 0) return filtered;
  return videos.filter((v) => v.unique_id !== currentVideoId);
}

const LIST_CAP = 8;
const COUNTDOWN_SEC = 5;

export default function EndScreen({
  suggestedVideos = [],
  seriesUpNextVideos = [],
  userActions: userActionsProp,
  currentUserId,
}: EndScreenProps) {
  const actions = userActionsProp ?? emptyUserActions;
  const { state, replay, autoPlay, containerRef, authPlaybackFeatures, file } = usePlayerContext();
  const { width: playerW, height: playerH } = usePlayerContainerSize(containerRef);
  const [countdown, setCountdown] = useState(COUNTDOWN_SEC);
  const [autoplayActive, setAutoplayActive] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const currentVideoId = file?.unique_id ?? params.uniqueId ?? params.id;
  const navigatingRef = useRef(false);

  const seriesQueue = useMemo(
    () => applyVisitedFilter(seriesUpNextVideos, currentVideoId),
    [seriesUpNextVideos, currentVideoId]
  );
  const relatedQueue = useMemo(
    () => applyVisitedFilter(suggestedVideos, currentVideoId),
    [suggestedVideos, currentVideoId]
  );

  const nextVideo = seriesQueue[0] ?? relatedQueue[0] ?? null;
  const nextFromSeries = Boolean(
    seriesQueue.length > 0 && nextVideo && nextVideo.unique_id === seriesQueue[0].unique_id
  );
  const showHero = Boolean(autoPlay && autoplayActive && nextVideo && authPlaybackFeatures);

  const seriesListForUi = showHero && nextFromSeries ? seriesQueue.slice(1) : seriesQueue;
  const relatedListForUi = showHero && !nextFromSeries ? relatedQueue.slice(1) : relatedQueue;

  const seriesToRender = seriesListForUi.slice(0, LIST_CAP);
  const relatedToRender = relatedListForUi.slice(0, LIST_CAP);

  const hasSeries = seriesQueue.length > 0;
  const hasRelated = relatedQueue.length > 0;
  const hasAnything = hasSeries || hasRelated;

  const showSeriesPanel =
    hasSeries && !(showHero && nextFromSeries && seriesToRender.length === 0);
  const showRelatedPanel =
    hasRelated && !(showHero && !nextFromSeries && relatedToRender.length === 0);

  const showSuggestionsGrid = showSeriesPanel || showRelatedPanel;

  const handleCancelAutoplay = useCallback(() => {
    setAutoplayActive(false);
  }, []);

  const handleVideoSelect = useCallback(
    (video: FileType) => {
      if (navigatingRef.current) return;
      navigatingRef.current = true;
      setAutoplayActive(false);
      addVisitedVideo(video.unique_id);
      const path = location.pathname.startsWith("/reel/")
        ? `/reel/${video.unique_id}`
        : `/${video.unique_id}`;
      navigate(path);
    },
    [navigate, location.pathname]
  );

  useEffect(() => {
    if (currentVideoId) {
      addVisitedVideo(currentVideoId);
    }
  }, [currentVideoId]);

  useEffect(() => {
    if (!state.isEnded) {
      setCountdown(COUNTDOWN_SEC);
      setAutoplayActive(true);
      navigatingRef.current = false;
    }
  }, [state.isEnded]);

  useEffect(() => {
    if (
      !state.isEnded ||
      !autoPlay ||
      !autoplayActive ||
      !nextVideo ||
      navigatingRef.current ||
      !authPlaybackFeatures
    ) {
      return;
    }

    if (countdown <= 0) {
      handleVideoSelect(nextVideo);
      return;
    }

    const timer = setTimeout(() => {
      setCountdown((c) => c - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [
    state.isEnded,
    autoPlay,
    autoplayActive,
    nextVideo,
    countdown,
    handleVideoSelect,
    authPlaybackFeatures,
  ]);

  const listMaxHeightPx = useMemo(() => {
    if (playerH <= 0) return 200;
    return Math.round(Math.min(Math.max(playerH * 0.36, 120), 340));
  }, [playerH]);

  const ui = playerEndUiLayout(playerW, playerH);
  const {
    sideBySideReplay,
    twoColumnSuggest,
    roomierPadding,
    largerType,
    replayRailWidth,
  } = ui;
  const heroUsesEndCard = playerW > 0 && playerW < 400;

  if (!state.isEnded) return null;

  const heroHeading = nextFromSeries ? "Next in series" : "Up next";
  const dashLen = (countdown / COUNTDOWN_SEC) * 100.5;
  const showTwoColumnGrid =
    twoColumnSuggest && showSeriesPanel && showRelatedPanel;

  return (
    <div
      className={cn(
        "absolute inset-0 z-40 flex min-h-0 flex-col overflow-hidden",
        "bg-gradient-to-b from-black/88 via-black/95 to-black",
        "backdrop-blur-md supports-[backdrop-filter]:bg-black/80"
      )}
    >
      <div
        className={cn(
          "min-h-0 flex-1 overflow-x-hidden overflow-y-auto",
          "pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.5rem,env(safe-area-inset-top))]"
        )}
      >
        <div
          className={cn(
            "mx-auto flex w-full min-w-0 max-w-full flex-col",
            roomierPadding ? "gap-4 px-3.5 py-3.5" : "gap-3 px-2.5 py-2.5",
            sideBySideReplay && "gap-5"
          )}
        >
          <div
            className={cn(
              "flex min-w-0 items-stretch",
              sideBySideReplay ? "flex-row gap-6" : "flex-col gap-3"
            )}
          >
            <div
              className={cn(
                "flex shrink-0 justify-center",
                sideBySideReplay &&
                  cn(
                    "flex-col items-center justify-start pt-1",
                    replayRailWidth ? "w-28" : "w-24"
                  )
              )}
            >
              <button
                type="button"
                onClick={replay}
                className={cn(
                  "group flex items-center gap-3",
                  sideBySideReplay ? "flex-col gap-2.5" : "flex-row"
                )}
              >
                <div
                  className={cn(
                    "flex shrink-0 items-center justify-center rounded-full border-2 transition-all",
                    "border-white/25 bg-white/[0.06] group-hover:border-white/50 group-hover:bg-white/10",
                    largerType ? "h-[4.25rem] w-[4.25rem]" : "h-14 w-14"
                  )}
                >
                  <RotateCcw
                    className={cn("text-white", largerType ? "h-8 w-8" : "h-7 w-7")}
                    strokeWidth={1.75}
                  />
                </div>
                <span
                  className={cn(
                    "font-medium text-white/95",
                    largerType ? "text-sm" : "text-[13px]",
                    sideBySideReplay && "text-center"
                  )}
                >
                  Replay
                </span>
              </button>
            </div>

            <div
              className={cn(
                "flex min-w-0 flex-1 flex-col",
                sideBySideReplay ? "gap-5" : "gap-3"
              )}
            >
              {showHero && nextVideo && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 gap-y-1">
                    <div className="flex min-w-0 items-center gap-2">
                      {nextFromSeries && (
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/30">
                          <Film className="h-4 w-4" strokeWidth={2} aria-hidden />
                        </span>
                      )}
                      <h3
                        className={cn(
                          "truncate font-semibold uppercase tracking-[0.12em] text-white/75",
                          largerType ? "text-sm" : "text-xs"
                        )}
                      >
                        {heroHeading}
                      </h3>
                    </div>
                    <div
                      className={cn(
                        "flex shrink-0 items-center",
                        largerType ? "gap-3" : "gap-2"
                      )}
                    >
                      <span
                        className={cn(
                          "text-white/45",
                          largerType ? "text-xs" : "text-[11px]"
                        )}
                      >
                        Playing in {countdown}s
                      </span>
                      <button
                        type="button"
                        onClick={handleCancelAutoplay}
                        className={cn(
                          "flex items-center gap-1 rounded-md px-2 py-1 text-white/55 transition-colors hover:bg-white/10 hover:text-white",
                          largerType ? "text-xs" : "text-[11px]"
                        )}
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={2} />
                        Cancel
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    className={cn(
                      "relative min-w-0 max-w-full overflow-hidden rounded-2xl border border-white/12 bg-white/[0.06] text-left",
                      "shadow-lg shadow-black/40 ring-1 ring-white/[0.06] transition hover:border-white/20 hover:bg-white/[0.09]"
                    )}
                    onClick={() => handleVideoSelect(nextVideo)}
                  >
                    <div
                      className={cn(
                        "pointer-events-none absolute left-2 top-2 z-10",
                        largerType && "left-3 top-3"
                      )}
                    >
                      <div
                        className={cn("relative", largerType ? "h-10 w-10" : "h-9 w-9")}
                      >
                        <svg
                          className={cn("h-full w-full -rotate-90")}
                          viewBox="0 0 40 40"
                        >
                          <circle
                            cx="20"
                            cy="20"
                            r="16"
                            fill="rgba(0,0,0,0.55)"
                            stroke="rgba(255,255,255,0.22)"
                            strokeWidth="3"
                          />
                          <circle
                            cx="20"
                            cy="20"
                            r="16"
                            fill="none"
                            stroke="white"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeDasharray={`${dashLen} 100.5`}
                            className="transition-all duration-1000 ease-linear"
                          />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span
                            className={cn(
                              "font-bold text-white",
                              largerType ? "text-sm" : "text-xs"
                            )}
                          >
                            {countdown}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="pointer-events-none min-w-0 max-w-full">
                      <VideoCard
                        data={nextVideo}
                        index={0}
                        userActions={actions}
                        currentUserId={currentUserId}
                        layout={heroUsesEndCard ? "endCard" : "horizontal"}
                        related={!heroUsesEndCard}
                        hideActions={{ completely: true }}
                      />
                    </div>
                  </button>
                </div>
              )}

              {!hasAnything && (
                <p className="py-6 text-center text-sm text-white/55">No more videos to suggest</p>
              )}

              {showSuggestionsGrid && (
                <div
                  className={cn(
                    "grid min-h-0 w-full min-w-0 max-w-full grid-cols-1 items-start",
                    showTwoColumnGrid ? "grid-cols-2 gap-4" : "gap-3"
                  )}
                >
                  {showSeriesPanel && (
                    <section
                      className={cn(
                        "flex min-h-0 min-w-0 flex-col rounded-2xl border border-white/[0.08] bg-white/[0.04]",
                        roomierPadding ? "p-3.5" : "p-2.5",
                        !showHero && "pt-3"
                      )}
                      aria-label="Series"
                    >
                      <div
                        className={cn(
                          "flex items-center gap-2",
                          roomierPadding ? "mb-3" : "mb-2"
                        )}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white/90">
                          <Film className="h-4 w-4" strokeWidth={2} aria-hidden />
                        </span>
                        <h4
                          className={cn(
                            "font-semibold text-white/90",
                            largerType ? "text-sm" : "text-[13px]"
                          )}
                        >
                          {showHero && nextFromSeries ? "Later in this series" : "From this series"}
                        </h4>
                      </div>
                      <div
                        className={cn(
                          "min-h-0 space-y-1.5 overflow-y-auto pr-0.5",
                          "custom-scrollbar"
                        )}
                        style={{ maxHeight: listMaxHeightPx }}
                      >
                        {seriesToRender.map((video, index) => (
                          <button
                            key={video.id ?? video.unique_id}
                            type="button"
                            className="w-full cursor-pointer rounded-xl text-left transition hover:bg-white/[0.06]"
                            onClick={() => handleVideoSelect(video)}
                          >
                            <div className="pointer-events-none">
                              <VideoCard
                                data={video}
                                index={index}
                                userActions={actions}
                                currentUserId={currentUserId}
                                layout="compact"
                                hideActions={{completely: true}}
                              />
                            </div>
                          </button>
                        ))}
                      </div>
                    </section>
                  )}

                  {showRelatedPanel && (
                    <section
                      className={cn(
                        "flex min-h-0 min-w-0 flex-col rounded-2xl border border-white/[0.08] bg-white/[0.04]",
                        roomierPadding ? "p-3.5" : "p-2.5",
                        !showHero && "pt-3"
                      )}
                      aria-label="Suggested videos"
                    >
                      <h4
                        className={cn(
                          "font-semibold text-white/90",
                          roomierPadding ? "mb-3" : "mb-2",
                          largerType ? "text-sm" : "text-[13px]"
                        )}
                      >
                        More to watch
                      </h4>
                      <div
                        className={cn(
                          "min-h-0 space-y-1.5 overflow-y-auto pr-0.5",
                          "custom-scrollbar"
                        )}
                        style={{ maxHeight: listMaxHeightPx }}
                      >
                        {relatedToRender.map((video, index) => (
                          <button
                            key={video.id ?? video.unique_id}
                            type="button"
                            className="w-full cursor-pointer rounded-xl text-left transition hover:bg-white/[0.06]"
                            onClick={() => handleVideoSelect(video)}
                          >
                            <div className="pointer-events-none">
                              <VideoCard
                                data={video}
                                index={index}
                                userActions={actions}
                                currentUserId={currentUserId}
                                layout="compact"
                                hideActions={{completely: true}}
                              />
                            </div>
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.18);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.28);
        }
      `}</style>
    </div>
  );
}
