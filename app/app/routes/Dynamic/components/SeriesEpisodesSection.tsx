import { useEffect, useMemo, useState } from "react";
import type { SeriesEpisodeGroup } from "~/lib/types";
import VideoCard from "~/routes/Home/components/VideoCard";
import { ChevronRight, Film } from "lucide-react";
import { cn } from "~/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";

function buildEpisodeOpenInitial(
  eps: SeriesEpisodeGroup[],
  currentUniqueId: string
): Record<string, boolean> {
  const m: Record<string, boolean> = {};
  for (const ep of eps) {
    const hasCurrent = ep.items.some((i) => i.unique_id === currentUniqueId);
    m[ep.episode_id] = hasCurrent;
  }
  if (eps.length && !Object.values(m).some(Boolean)) {
    m[eps[0].episode_id] = true;
  }
  return m;
}

interface SeriesEpisodesSectionProps {
  episodes: SeriesEpisodeGroup[];
  currentVideoUniqueId: string;
  currentUserId?: string;
  userActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
}

export default function SeriesEpisodesSection({
  episodes,
  currentVideoUniqueId,
  currentUserId,
  userActions,
}: SeriesEpisodesSectionProps) {
  const [seriesOpen, setSeriesOpen] = useState(true);
  const [episodeOpen, setEpisodeOpen] = useState<Record<string, boolean>>(() =>
    buildEpisodeOpenInitial(episodes, currentVideoUniqueId)
  );

  const episodeKey = useMemo(
    () => episodes.map((e) => e.episode_id).join("|"),
    [episodes]
  );

  useEffect(() => {
    setEpisodeOpen((prev) => {
      const next = { ...prev };
      for (const ep of episodes) {
        if (next[ep.episode_id] === undefined) {
          next[ep.episode_id] = ep.items.some((i) => i.unique_id === currentVideoUniqueId);
        }
      }
      for (const ep of episodes) {
        if (ep.items.some((i) => i.unique_id === currentVideoUniqueId)) {
          next[ep.episode_id] = true;
        }
      }
      return next;
    });
  }, [currentVideoUniqueId, episodeKey, episodes]);

  if (!episodes.length) return null;

  const totalItems = episodes.reduce((n, ep) => n + ep.items.length, 0);

  return (
    <section
      className={cn(
        "mb-5 rounded-2xl border border-border/50 bg-card/40 backdrop-blur-[2px]",
        "shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_8px_24px_-12px_rgba(0,0,0,0.18)]",
        "dark:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_12px_32px_-16px_rgba(0,0,0,0.45)]"
      )}
      aria-label="Series"
    >
      <Collapsible open={seriesOpen} onOpenChange={setSeriesOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              "w-full text-left rounded-2xl px-4 py-3.5 transition-colors duration-200",
              "hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              "data-[state=open]:rounded-b-none data-[state=open]:border-b data-[state=open]:border-border/40"
            )}
          >
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-[15px] font-medium leading-snug text-foreground">
                  Series
                </p>
              </div>
              <ChevronRight
                className={cn(
                  "mt-1.5 h-5 w-5 shrink-0 text-muted-foreground/70 transition-transform duration-300 ease-out",
                  seriesOpen && "rotate-90"
                )}
                strokeWidth={1.75}
                aria-hidden
              />
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-2 pb-2 pt-1 sm:px-3 sm:pb-3 max-h-[min(72vh,560px)] overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
            <ul className="space-y-1.5 list-none m-0 p-0">
              {episodes.map((ep) => {
                const label = ep.episode_name?.trim() || "Episode";
                const part =
                  ep.episode_number != null && !Number.isNaN(ep.episode_number)
                    ? `Part ${ep.episode_number}`
                    : null;

                return (
                  <li key={ep.episode_id} className="rounded-xl border border-transparent">
                    <Collapsible
                      open={!!episodeOpen[ep.episode_id]}
                      onOpenChange={(next) =>
                        setEpisodeOpen((prev) => ({ ...prev, [ep.episode_id]: next }))
                      }
                    >
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            "flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-all duration-200",
                            "hover:bg-muted/40 active:scale-[0.99]",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-inset",
                            "data-[state=open]:bg-muted/25 data-[state=open]:border data-[state=open]:border-border/35 data-[state=open]:shadow-sm"
                          )}
                        >
                          <ChevronRight
                            className={cn(
                              "h-4 w-4 shrink-0 text-muted-foreground/80 transition-transform duration-200 ease-out",
                              episodeOpen[ep.episode_id] && "rotate-90"
                            )}
                            strokeWidth={2}
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1 flex items-center gap-2 justify-between">
                            <span className="block text-[14px] font-medium leading-snug text-foreground">
                              {label}
                            </span>
                            <span className="mt-0.5 block text-[12px] text-muted-foreground">
                              {[part, `${ep.items.length} video${ep.items.length === 1 ? "" : "s"}`]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </div>
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="mt-1 mb-2 ml-2 border-l-2 border-primary/20 pl-3 pr-1 space-y-1">
                          {ep.items.map((video, index) => {
                            const isCurrent = video.unique_id === currentVideoUniqueId;
                            return (
                              <div
                                key={video.unique_id}
                                className={cn(
                                  "rounded-lg transition-colors duration-200",
                                  isCurrent && "bg-primary/[0.07] ring-1 ring-primary/25"
                                )}
                              >
                                <VideoCard
                                  layout={`horizontal`}
                                  data={video}
                                  index={index}
                                  currentUserId={currentUserId}
                                  userActions={userActions}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </li>
                );
              })}
            </ul>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
