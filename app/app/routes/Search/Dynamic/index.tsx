import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { data, useLoaderData, Link } from "react-router";
import { User, Layers } from "lucide-react";

import { useFileContext } from "~/lib/Context/Context";
import type { FileType } from "~/lib/types";
import { Button } from "~/components/ui/button";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import VideoCard from "~/routes/Home/components/VideoCard";
import { SignInToSeeMore } from "~/components/SignInWall";
import db from "~/lib/Database/supabase";
import { isAuthenticated } from "~/lib/Security/Password";
import { sanitizeSearchQuery } from "~/lib/Security/inputValidation";
import { groupConsecutiveReelClusters } from "~/lib/feed/groupConsecutiveReelClusters";
import { Swiper, SwiperSlide } from "swiper/react";
import { Navigation, A11y, Keyboard } from "swiper/modules";
import type { Swiper as SwiperType } from "swiper";
import "swiper/css";
import "swiper/css/navigation";

const SEARCH_LIMIT = 20;
const SERIES_ROOTS_LIMIT = 8;

function mapSearchFile(file: any) {
  return {
    id: file.id,
    created_at: file.created_at,
    endpoint: file.endpoint || '',
    filename: file.filename,
    unique_id: file.unique_id,
    file_size: file.file_size,
    file_type: file.file_type,
    is_adult: file.is_adult,
    owner_id: file.owner_id,
    is_public: file.is_public,
    file_description: file.file_description,
    file_title: file.file_title || '',
    default_thumbnail: file.default_thumbnail || null,
    view_count: file.view_count,
    share_count: file.share_count,
    is_reel: file.is_reel,
    // Series fields — required for VideoCard badges + resume click logic.
    is_series_main: file.is_series_main,
    is_series_episode: file.is_series_episode,
    is_files_series_item: file.is_files_series_item,
    file_series_id: file.file_series_id,
    file_series_episode_id: file.file_series_episode_id,
    feed_reel_cluster_id:
      file.feed_reel_cluster_id != null && file.feed_reel_cluster_id !== ""
        ? Number(file.feed_reel_cluster_id)
        : undefined,
    duration: file.duration,
    categories: file.categories,
    tags: file.tags,
    colors: file.colors,
    metadata: file.metadata,
    like_count: Number(file.like_count) || 0,
    dislike_count: Number(file.dislike_count) || 0,
    comment_count: Number(file.comment_count) || 0,
    engagement_score: file.search_rank ?? 0,
    owner: file.owner_username
      ? {
          id: file.owner_id,
          username: file.owner_username,
          profile_pic: file.owner_profile_pic || '',
          verified: file.owner_verified ?? false,
        }
      : null,
  };
}

function dedupeSeriesRoots(seriesRoots: FileType[], files: FileType[]): FileType[] {
  const seen = new Set(files.map((f) => f.id).filter(Boolean));
  return seriesRoots.filter((s) => s.id && !seen.has(s.id));
}

export const loader = async ({ request }: { request: Request }) => {
  try {
    let term = request.url.split(`/search/`)[1];
    if (term && term.includes('?')) {
      term = term.split('?')[0];
    }
    if (!term) return data(null, { status: 404 });
    try {
      term = decodeURIComponent(term);
    } catch {
      return data(null, { status: 400 });
    }
    const sanitizedTerm = sanitizeSearchQuery(term);
    if (!sanitizedTerm) {
      return data({
        url: '',
        results: [],
        seriesRoots: [],
        users: [],
        userActions: { likedFileIds: [], dislikedFileIds: [] },
        nextCursor: null,
        hasMore: false,
      }, { status: 200 });
    }

    const user = await isAuthenticated(request, ['id']);
    const userId: string | undefined = user?.id || undefined;

    let results: any[] = [];
    let seriesRoots: FileType[] = [];
    let likedFileIds: string[] = [];
    let dislikedFileIds: string[] = [];
    let nextCursor: { cursor_score: number; cursor_id: string } | null = null;
    let users: Array<{ id: string; username: string; profile_pic: string; file_count: number }> = [];

    try {
      if (db) {
        const [searchResult, seriesRootsResult, usersResult] = await Promise.all([
          db.rpc('search_files', {
            p_query: sanitizedTerm,
            p_user_id: userId || null,
            p_limit: SEARCH_LIMIT,
            p_file_type: null,
            p_category: null,
            p_sort_by: 'relevance',
            p_cursor_score: null,
            p_cursor_id: null,
          }),
          db.rpc('search_series_roots_for_query', {
            p_query: sanitizedTerm,
            p_user_id: userId || null,
            p_limit: SERIES_ROOTS_LIMIT,
          }),
          db
            .from('users')
            .select('id, username, profile_pic, file_count')
            .ilike('username', `%${sanitizedTerm}%`)
            .eq('is_memories', false)
            .limit(10),
        ]);

        if (searchResult.error) {
          console.error("search_files RPC error:", searchResult.error);
        } else if (Array.isArray(searchResult.data)) {
          results = searchResult.data.map((file: any) => {
            if (file.user_has_liked) likedFileIds.push(file.id);
            if (file.user_has_disliked) dislikedFileIds.push(file.id);
            return mapSearchFile(file);
          });

          const lastItem = results[results.length - 1];
          if (lastItem && results.length >= SEARCH_LIMIT) {
            nextCursor = { cursor_score: lastItem.engagement_score, cursor_id: lastItem.id };
          }
        }

        if (!seriesRootsResult.error && Array.isArray(seriesRootsResult.data)) {
          const mapped = (seriesRootsResult.data as any[]).map((file: any) => {
            if (file.user_has_liked) likedFileIds.push(file.id);
            if (file.user_has_disliked) dislikedFileIds.push(file.id);
            return mapSearchFile(file);
          });
          seriesRoots = dedupeSeriesRoots(mapped, results);
        } else if (seriesRootsResult.error) {
          console.error("search_series_roots_for_query RPC error:", seriesRootsResult.error);
        }

        if (!usersResult.error && Array.isArray(usersResult.data) && usersResult.data.length > 0) {
          const userData = usersResult.data as Array<{ id: string; username: string; profile_pic: string; file_count: number | null }>;
          users = userData.map((u) => ({
            id: u.id,
            username: u.username,
            profile_pic: u.profile_pic || '',
            file_count: u.file_count ?? 0,
          }));
        }
      }
    } catch (e) {
      console.error("Server search failed:", e);
    }

    return data({
      url: sanitizedTerm,
      results,
      seriesRoots,
      users,
      userActions: { likedFileIds, dislikedFileIds },
      nextCursor,
      hasMore: Boolean(nextCursor),
    }, { status: 200 });
  } catch (error) {
    console.error("Search loader error:", error);
    return data(null, { status: 500 });
  }
};

function SkeletonCard() {
  return (
    <div className="animate-pulse">
      <div className="aspect-video bg-muted rounded-xl" />
      <div className="flex gap-3 mt-3">
        <div className="w-9 h-9 rounded-full bg-muted shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-muted rounded w-[85%]" />
          <div className="h-3 bg-muted rounded w-[60%]" />
        </div>
      </div>
    </div>
  );
}

const Search = () => {
  const loaderData = useLoaderData<typeof loader>();
  const { userActions: globalUserActions, userId } = useFileContext();

  const initialTerm = useMemo(() => {
    if (!loaderData || typeof loaderData?.url !== "string") return "";
    return loaderData.url.trim();
  }, [loaderData]);

  const [activeTerm, setActiveTerm] = useState(initialTerm);
  const [files, setFiles] = useState<FileType[]>([]);
  const [localUserActions, setLocalUserActions] = useState<{ likedFileIds: Set<string>; dislikedFileIds: Set<string> }>({
    likedFileIds: new Set(),
    dislikedFileIds: new Set(),
  });
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const nextCursorRef = useRef<{ cursor_score: number; cursor_id: string } | null>(null);
  const [suggestions, setSuggestions] = useState<FileType[]>([]);

  const seriesRoots = useMemo((): FileType[] => {
    if (!loaderData || typeof loaderData !== "object") return [];
    const sr = (loaderData as { seriesRoots?: unknown }).seriesRoots;
    return Array.isArray(sr) ? (sr as FileType[]) : [];
  }, [loaderData]);

  useEffect(() => {
    if (!loaderData || typeof loaderData !== 'object') return;
    const ld = loaderData as any;
    setFiles(Array.isArray(ld.results) ? ld.results : []);
    setHasMore(Boolean(ld.hasMore));
    nextCursorRef.current = ld.nextCursor ?? null;

    const liked = new Set<string>(globalUserActions.likedFileIds);
    const disliked = new Set<string>(globalUserActions.dislikedFileIds);
    if (ld.userActions) {
      ld.userActions.likedFileIds?.forEach((id: string) => liked.add(id));
      ld.userActions.dislikedFileIds?.forEach((id: string) => disliked.add(id));
    }
    setLocalUserActions({ likedFileIds: liked, dislikedFileIds: disliked });
  }, [loaderData, globalUserActions]);

  useEffect(() => {
    setActiveTerm(initialTerm);
  }, [initialTerm]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore || !activeTerm) return;
    const cursor = nextCursorRef.current;
    if (!cursor) return;

    setIsLoadingMore(true);
    try {
      const params = new URLSearchParams();
      params.set("q", activeTerm);
      params.set("cursor_score", String(cursor.cursor_score));
      params.set("cursor_id", cursor.cursor_id);

      const response = await fetch(`/api/search?${params}`);
      if (!response.ok) {
        setHasMore(false);
        return;
      }

      const result = await response.json();

      if (Array.isArray(result.data) && result.data.length > 0) {
        setFiles(prev => {
          const existingIds = new Set(prev.map((f: FileType) => f.id));
          const newItems = result.data.filter((f: FileType) => !existingIds.has(f.id));
          return [...prev, ...newItems];
        });

        nextCursorRef.current = result.nextCursor ?? null;
        setHasMore(Boolean(result.nextCursor));

        if (result.userActions) {
          setLocalUserActions(prev => {
            const liked = new Set(prev.likedFileIds);
            const disliked = new Set(prev.dislikedFileIds);
            result.userActions.likedFileIds?.forEach((id: string) => liked.add(id));
            result.userActions.dislikedFileIds?.forEach((id: string) => disliked.add(id));
            return { likedFileIds: liked, dislikedFileIds: disliked };
          });
        }
      } else {
        setHasMore(false);
      }
    } catch {
      setHasMore(false);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, activeTerm]);

  const searchUsers = useMemo(() => {
    if (loaderData && typeof loaderData === 'object' && 'users' in loaderData) {
      return Array.isArray((loaderData as any).users) ? (loaderData as any).users : [];
    }
    return [];
  }, [loaderData]);

  useEffect(() => {
    if (activeTerm) return;
    const fetchFeed = async () => {
      try {
        const response = await fetch('/api/feed');
        if (response.ok) {
          const result = await response.json();
          if (Array.isArray(result.data)) {
            setSuggestions(result.data);
            if (result.userActions) {
              setLocalUserActions(prev => {
                const liked = new Set(prev.likedFileIds);
                const disliked = new Set(prev.dislikedFileIds);
                result.userActions.likedFileIds?.forEach((id: string) => liked.add(id));
                result.userActions.dislikedFileIds?.forEach((id: string) => disliked.add(id));
                return { likedFileIds: liked, dislikedFileIds: disliked };
              });
            }
          }
        }
      } catch {}
    };
    fetchFeed();
  }, [activeTerm]);

  const showSuggestions =
    activeTerm && files.length === 0 && searchUsers.length === 0 && seriesRoots.length === 0;

  const renderFileGroups = (items: FileType[], keyPrefix: string) => {
    const groups = groupConsecutiveReelClusters(items);
    let indexCounter = 0;
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2">
        {groups.map((g) => {
          if (g.kind === "single") {
            const file = g.file;
            const index = indexCounter++;
            return (
              <VideoCard
                key={`${keyPrefix}-${file.id || file.unique_id || index}`}
                data={file}
                index={index}
                userActions={localUserActions}
                currentUserId={userId || undefined}
                hideActions={{ completely: false,  }}
                layout={`shelf`}
              />
            );
          }
          const clusterKey = g.files[0]?.feed_reel_cluster_id ?? g.files[0]?.id ?? keyPrefix;
          return (
            <div
              key={`${keyPrefix}-reel-${clusterKey}`}
              className="col-span-full w-full min-w-0 max-w-full overflow-hidden"
            >
              <Swiper
                modules={[Navigation, A11y, Keyboard]}
                slidesPerView={3.15}
                spaceBetween={10}
                speed={380}
                watchOverflow
                observer
                observeParents
                resizeObserver
                navigation
                keyboard={{ enabled: true, onlyInViewport: true }}
                breakpoints={{
                  640: { slidesPerView: 2.5, spaceBetween: 12 },
                  768: { slidesPerView: 3, spaceBetween: 12 },
                  1024: { slidesPerView: 3.5, spaceBetween: 14 },
                  1280: { slidesPerView: 4, spaceBetween: 14 },
                  1536: { slidesPerView: 5, spaceBetween: 16 },
                }}
                className="feed-reel-swiper"
                onInit={(swiper: SwiperType) => swiper.update()}
              >
                {g.files.map((file, keyIndex) => {
                  const index = indexCounter++;
                  return (
                    <SwiperSlide key={file.id || file.unique_id || keyIndex} className="!h-auto">
                      <VideoCard
                        data={file}
                        layout="reelStrip"
                        index={index}
                        userActions={localUserActions}
                        currentUserId={userId || undefined}
                        hideActions={{ completely: true, halfway: false }}
                      />
                    </SwiperSlide>
                  );
                })}
              </Swiper>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="mx-auto w-full py-10">
      <div className="space-y-8">
        {activeTerm ? (
          files.length > 0 || searchUsers.length > 0 || seriesRoots.length > 0 ? (
            <div className="space-y-6">
              {searchUsers.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground">Users</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {searchUsers.map((user: { id: string; username: string; profile_pic: string; file_count: number }) => (
                      <Link
                        key={user.id}
                        to={`/profile/${user.username}`}
                        className="group flex flex-col items-center p-4 rounded-xl border border-border/30 bg-card hover:bg-accent/50 transition-all hover:shadow-md"
                      >
                        <div className="relative w-20 h-20 rounded-full overflow-hidden mb-3 ring-2 ring-border/50 group-hover:ring-primary/50 transition-all">
                          {user.profile_pic ? (
                            <img
                              src={getProfilePicUrl(user.profile_pic)}
                              alt={user.username}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full bg-primary/10 flex items-center justify-center">
                              <User className="w-8 h-8 text-primary/60" />
                            </div>
                          )}
                        </div>
                        <h4 className="font-semibold text-sm text-foreground text-center mb-1 line-clamp-1 group-hover:text-primary transition-colors">
                          {user.username}
                        </h4>
                        <p className="text-xs text-muted-foreground">
                          {user.file_count} {user.file_count === 1 ? 'file' : 'files'}
                        </p>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {seriesRoots.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-start gap-2">
                    <Layers className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">Found in {seriesRoots.length < 2 ? `this` : `one of these`} series</h3>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2">
                    {seriesRoots.map((file, idx) => (
                      <VideoCard
                        key={file.id || file.unique_id || `sr-${idx}`}
                        data={file}
                        index={idx}
                        userActions={localUserActions}
                        currentUserId={userId || undefined}
                        hideActions={{ completely: true, halfway: false }}
                        layout={`shelf`}
                      />
                    ))}
                  </div>
                </div>
              )}

              {files.length > 0 && (
                <div className="space-y-4">
                  {(searchUsers.length > 0 || seriesRoots.length > 0) && (
                    <h3 className="text-lg font-semibold text-foreground">Files</h3>
                  )}
                  {renderFileGroups(files, "search")}

                  {isLoadingMore && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <SkeletonCard key={`skeleton-${i}`} />
                      ))}
                    </div>
                  )}

                  {hasMore && !isLoadingMore && (
                    userId ? (
                      <div className="flex justify-center pt-2">
                        <Button variant="outline" className="rounded-full px-8" onClick={loadMore}>
                          Load more results
                        </Button>
                      </div>
                    ) : (
                      <SignInToSeeMore />
                    )
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
                <h2 className="text-xl font-semibold text-foreground">No results found</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Try adjusting your search or explore these suggestions.
                </p>
              </div>

              {showSuggestions && suggestions.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground">Suggested for you</h3>
                  {renderFileGroups(suggestions, "suggested")}
                </div>
              )}
            </div>
          )
        ) : (
          suggestions.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-foreground">Quick suggestions</h3>
              {renderFileGroups(suggestions, "quick")}
            </div>
          )
        )}
      </div>
    </div>
  );
};

export default Search;
