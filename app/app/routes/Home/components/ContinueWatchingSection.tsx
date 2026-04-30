import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Swiper, SwiperSlide } from "swiper/react";
import { A11y, Keyboard, Navigation, Pagination } from "swiper/modules";
import type { Swiper as SwiperType } from "swiper";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/pagination";

import type { FileType } from "~/lib/types";
import VideoCard from "./VideoCard";
import { cn } from "~/lib/utils";
import { Separator } from "~/components/ui/separator";

type Props = {
  userId: string | null;
  userActions: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
  username?: string | null;
};

function isMarkedAdult(isAdult: unknown): boolean {
  if (isAdult === true || isAdult === 1) return true;
  if (typeof isAdult === "string" && ["true", "t", "1", "yes", "y"].includes(isAdult.trim().toLowerCase())) {
    return true;
  }
  return false;
}

/** Align with profile-tab loader mapping so VideoCard gets stable ids, counts, and owner. */
function normalizeProfileTabFiles(rows: FileType[]): FileType[] {
  return rows.map((r) => {
    const id = String(r.id);
    return {
      ...r,
      id,
      like_count: Number(r.like_count ?? r.up_count) || 0,
      dislike_count: Number(r.dislike_count ?? r.down_count) || 0,
      comment_count: Number(r.comment_count) || 0,
      view_count: Number(r.view_count ?? r.views) || 0,
      owner: r.owner
        ? {
            id: String(r.owner.id ?? r.owner_id ?? ""),
            username: r.owner.username,
            profile_pic: r.owner.profile_pic ?? "",
            verified: Boolean(r.owner.verified),
            about: r.owner.about ?? null,
          }
        : r.owner,
    };
  });
}

export function ContinueWatchingSection({ userId, userActions, username }: Props) {
  const [items, setItems] = useState<FileType[]>([]);
  const [loading, setLoading] = useState(false);
  /** Per-request liked/disliked ids from `/api/profile-tab` (same pattern as ProfileTabVideosGrid). */
  const [tabUserActions, setTabUserActions] = useState<{ liked: string[]; disliked: string[] }>({
    liked: [],
    disliked: [],
  });

  const mergedUserActions = useMemo(() => {
    const liked = new Set<string>();
    const disliked = new Set<string>();
    userActions.likedFileIds.forEach((id) => liked.add(String(id)));
    userActions.dislikedFileIds.forEach((id) => disliked.add(String(id)));
    tabUserActions.liked.forEach((id) => liked.add(String(id)));
    tabUserActions.disliked.forEach((id) => disliked.add(String(id)));
    return { likedFileIds: liked, dislikedFileIds: disliked };
  }, [userActions, tabUserActions]);

  const handleFileUpdate = useCallback((fileId: string, updates: Partial<FileType>) => {
    setItems((prev) =>
      prev.map((file) => (file.id === fileId || file.unique_id === fileId ? { ...file, ...updates } : file))
    );
  }, []);

  useEffect(() => {
    if (!userId) {
      setItems([]);
      setTabUserActions({ liked: [], disliked: [] });
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/profile-tab?userId=${encodeURIComponent(userId)}&tab=history&page=1&limit=8`, {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const raw = Array.isArray(j?.data) ? (j.data as FileType[]) : [];
        const likedFromPage = (j?.userActions?.likedFileIds ?? []) as string[];
        const dislikedFromPage = (j?.userActions?.dislikedFileIds ?? []) as string[];
        setTabUserActions({
          liked: likedFromPage.map(String),
          disliked: dislikedFromPage.map(String),
        });
        setItems(normalizeProfileTabFiles(raw).filter((v) => !isMarkedAdult(v.is_adult)));
      })
      .catch(() => {
        if (!cancelled) {
          setItems([]);
          setTabUserActions({ liked: [], disliked: [] });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!userId) return null;

  return (
    <div id="home-continue-watching" className="min-w-0 scroll-mt-24 bg-muted/10" aria-label="Recently watched">
      <div
        className={cn(
          "mt-6 px-3 py-4 sm:px-4 sm:py-5",
          // "dark:bg-muted/15"
        )}
      >
        {username ? (
          <div className="mb-3 flex justify-between items-center">
            <h1 className="text-sm font-medium text-foreground">Continue Watching</h1>
            <Link
              to={`/profile/${encodeURIComponent(username)}`}
              className="text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              See all
            </Link>
          </div>
        ) : null}

        {loading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-pulse space-y-2 rounded-xl border border-border/60 bg-background/40 p-2">
                <div className="aspect-video rounded-lg bg-muted" />
                <div className="h-3 w-[75%] rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : items.length > 0 ? (
          <Swiper
            modules={[Navigation, Pagination, A11y, Keyboard]}
            slidesPerView={2}
            spaceBetween={12}
            speed={380}
            watchOverflow
            navigation
            keyboard={{ enabled: true, onlyInViewport: true }}
            pagination={{
              clickable: true,
              dynamicBullets: items.length > 6,
            }}
            breakpoints={{
              640: { slidesPerView: 2, spaceBetween: 12 },
              1024: { slidesPerView: 4, spaceBetween: 14 },
              1280: { slidesPerView: 5, spaceBetween: 16 },
            }}
            className="continue-watching-swiper"
            onInit={(swiper: SwiperType) => {
              swiper.update();
            }}
          >
            {items.map((file, index) => (
              <SwiperSlide key={file.id || file.unique_id} className="!h-auto">
                <div className="h-full rounded-xl border border-border/50 bg-background/60 p-1 shadow-sm">
                  <VideoCard
                    data={file}
                    index={index}
                    currentUserId={userId}
                    userActions={mergedUserActions}
                    onUpdate={handleFileUpdate}
                    hideActions={{completely: false}}
                  />
                </div>
              </SwiperSlide>
            ))}
          </Swiper>
        ) : (
          <p className="rounded-lg border border-dashed border-border/70 bg-background/40 px-4 py-6 text-center text-sm text-muted-foreground">
            Nothing here yet.
          </p>
        )}
      </div>

    </div>
  );
}

/** Split index: first chunk before history strip, second chunk after. */
export function getContinueWatchingSplitIndex(fileCount: number): number {
  if (fileCount <= 0) return 0;
  if (fileCount <= 1) return fileCount;
  return Math.max(1, Math.min(Math.floor(fileCount / 2), fileCount - 1));
}
