import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { data, useLoaderData, useNavigate, Link } from "react-router";
import { Search as SearchIcon, X as XIcon, User } from "lucide-react";

import { useFileContext } from "~/lib/Context/Context";
import type { FileType } from "~/lib/types";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import VideoCard from "~/routes/Home/components/VideoCard";
import db from "~/lib/Database/supabase";
import { isAuthenticated } from "~/lib/Security/Password";
import { sanitizeSearchQuery } from "~/lib/Security/inputValidation";

const SEARCH_LIMIT = 20;

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
    thumbnails: file.thumbnails || [],
    view_count: file.view_count,
    share_count: file.share_count,
    is_reel: file.is_reel,
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
        users: [],
        userActions: { likedFileIds: [], dislikedFileIds: [] },
        nextCursor: null,
        hasMore: false,
      }, { status: 200 });
    }

    const user = await isAuthenticated(request, ['id']);
    const userId: string | undefined = user?.id || undefined;

    let results: any[] = [];
    let likedFileIds: string[] = [];
    let dislikedFileIds: string[] = [];
    let nextCursor: { cursor_score: number; cursor_id: string } | null = null;
    let users: Array<{ id: string; username: string; profile_pic: string; file_count: number }> = [];

    try {
      if (db) {
        const [searchResult, usersResult] = await Promise.all([
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
          db
            .from('users')
            .select('id, username, profile_pic')
            .ilike('username', `%${sanitizedTerm}%`)
            .eq('is_memories', false)
            .limit(10),
        ]);

        if (searchResult.error) {
          console.error("search_files RPC error:", searchResult.error);
        } else if (Array.isArray(searchResult.data)) {
          const rawList = searchResult.data;
          const fileIds = rawList.map((f: any) => f.id).filter(Boolean);
          const interactionsByFile = new Map<
            string,
            { like_count: number; dislike_count: number; comment_count: number; user_has_liked: boolean; user_has_disliked: boolean }
          >();
          if (fileIds.length > 0) {
            const { data: batch } = await db.rpc('get_batch_interactions', {
              p_file_ids: fileIds,
              p_user_id: userId || null,
            });
            if (Array.isArray(batch)) {
              for (const row of batch) {
                if (row?.file_id) {
                  const fid = String(row.file_id);
                  interactionsByFile.set(fid, {
                    like_count: Number(row.like_count) ?? 0,
                    dislike_count: Number(row.dislike_count) ?? 0,
                    comment_count: Number(row.comment_count) ?? 0,
                    user_has_liked: !!row.user_has_liked,
                    user_has_disliked: !!row.user_has_disliked,
                  });
                }
              }
            }
          }
          results = rawList.map((file: any) => {
            const fid = file.id ? String(file.id) : '';
            const interactions = fid ? interactionsByFile.get(fid) : undefined;
            const likeCount = interactions ? interactions.like_count : Number(file.like_count) || 0;
            const dislikeCount = interactions ? interactions.dislike_count : Number(file.dislike_count) || 0;
            const commentCount = interactions ? interactions.comment_count : Number(file.comment_count) || 0;
            const userHasLiked = interactions ? interactions.user_has_liked : !!file.user_has_liked;
            const userHasDisliked = interactions ? interactions.user_has_disliked : !!file.user_has_disliked;
            if (userHasLiked) likedFileIds.push(file.id);
            if (userHasDisliked) dislikedFileIds.push(file.id);
            const mapped = mapSearchFile(file);
            return { ...mapped, like_count: likeCount, dislike_count: dislikeCount, comment_count: commentCount };
          });

          const lastItem = results[results.length - 1];
          if (lastItem && results.length >= SEARCH_LIMIT) {
            nextCursor = { cursor_score: lastItem.engagement_score, cursor_id: lastItem.id };
          }
        }

        if (!usersResult.error && Array.isArray(usersResult.data) && usersResult.data.length > 0) {
          const userData = usersResult.data as Array<{ id: string; username: string; profile_pic: string }>;
          const withCounts = await Promise.all(
            userData.map(async (u) => {
              const { count } = await db
                .from('files')
                .select('*', { count: 'exact', head: true })
                .eq('owner_id', u.id);
              return {
                id: u.id,
                username: u.username,
                profile_pic: u.profile_pic || '',
                file_count: count || 0,
              };
            })
          );
          users = withCounts;
        }
      }
    } catch (e) {
      console.error("Server search failed:", e);
    }

    return data({
      url: sanitizedTerm,
      results,
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
  const navigate = useNavigate();
  const { userActions: globalUserActions, userId } = useFileContext();

  const initialTerm = useMemo(() => {
    if (!loaderData || typeof loaderData?.url !== "string") return "";
    return loaderData.url.trim();
  }, [loaderData]);

  const [inputValue, setInputValue] = useState(initialTerm);
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
    setInputValue(initialTerm);
    setActiveTerm(initialTerm);
  }, [initialTerm]);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = inputValue.trim();
      if (!trimmed) return;
      setActiveTerm(trimmed);
      navigate(`/search/${encodeURIComponent(trimmed)}`, { replace: false });
    },
    [inputValue, navigate]
  );

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

  const showSuggestions = activeTerm && files.length === 0 && searchUsers.length === 0;

  return (
    <div className="mx-auto w-full py-10">
      <div className="space-y-8">
        <form onSubmit={handleSubmit} className="w-full">
          <div className="mx-auto w-full md:max-w-2xl">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex flex-1 items-center gap-2 rounded-full border border-border/30 bg-primary/5 backdrop-blur-xl px-4 h-12 shadow-xs focus-within:ring-4 focus-within:ring-primary/10">
                <SearchIcon className="h-4 w-4 text-muted-foreground" />
                <Input
                  autoFocus
                  type="search"
                  enterKeyHint="search"
                  inputMode="search"
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  placeholder="Search photos, videos, users, IDs"
                  className="h-12 border-0 px-0 text-base shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/70"
                />
                {inputValue && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setInputValue('')}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted/70 text-muted-foreground hover:bg-muted transition-colors"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <Button type="submit" className="h-12 rounded-full px-6 font-medium shadow-sm">
                Search
              </Button>
            </div>
          </div>
        </form>

        {activeTerm ? (
          (files.length > 0 || searchUsers.length > 0) ? (
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

              {files.length > 0 && (
                <div className="space-y-4">
                  {searchUsers.length > 0 && (
                    <h3 className="text-lg font-semibold text-foreground">Files</h3>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2">
                    {files.map((file: FileType, index: number) => (
                      <VideoCard
                        key={file.id || index}
                        data={file}
                        index={index}
                        userActions={localUserActions}
                        currentUserId={userId || undefined}
                      />
                    ))}
                  </div>

                  {isLoadingMore && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <SkeletonCard key={`skeleton-${i}`} />
                      ))}
                    </div>
                  )}

                  {hasMore && !isLoadingMore && (
                    <div className="flex justify-center pt-2">
                      <Button variant="outline" className="rounded-full px-8" onClick={loadMore}>
                        Load more results
                      </Button>
                    </div>
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3 gap-4">
                    {suggestions.map((file: FileType, index: number) => (
                      <VideoCard
                        key={file.id || index}
                        data={file}
                        index={index}
                        userActions={localUserActions}
                        currentUserId={userId || undefined}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        ) : (
          suggestions.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-foreground">Quick suggestions</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3 gap-4">
                {suggestions.map((file: FileType, index: number) => (
                  <VideoCard
                    key={file.id || index}
                    data={file}
                    index={index}
                    userActions={localUserActions}
                    currentUserId={userId || undefined}
                  />
                ))}
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
};

export default Search;
