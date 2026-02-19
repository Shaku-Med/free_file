import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { Search as SearchIcon, X as XIcon, User, ExternalLink } from "lucide-react";
import { useFileContext } from "~/lib/Context/Context";
import type { FileType } from "~/lib/types";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import VideoCard from "~/routes/Home/components/VideoCard";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

type SearchUser = { id: string; username: string; profile_pic: string; file_count: number };

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

interface SearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SearchModal({ open, onOpenChange }: SearchModalProps) {
  const { userActions: globalUserActions, userId } = useFileContext();
  const location = useLocation();
  const prevLocationKeyRef = useRef(location.key);
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    if (location.key !== prevLocationKeyRef.current) {
      prevLocationKeyRef.current = location.key;
      if (open) onOpenChange(false);
    }
  }, [location.key, open, onOpenChange]);

  const [activeTerm, setActiveTerm] = useState("");
  const [files, setFiles] = useState<FileType[]>([]);
  const [searchUsers, setSearchUsers] = useState<SearchUser[]>([]);
  const [localUserActions, setLocalUserActions] = useState<{
    likedFileIds: Set<string>;
    dislikedFileIds: Set<string>;
  }>({ likedFileIds: new Set(), dislikedFileIds: new Set() });
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [suggestions, setSuggestions] = useState<FileType[]>([]);
  const nextCursorRef = useRef<{ cursor_score: number; cursor_id: string } | null>(null);

  const runSearch = useCallback(async (term: string, append: boolean) => {
    if (!term.trim()) return;
    if (append) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
    }
    try {
      const params = new URLSearchParams();
      params.set("q", term.trim());
      if (append && nextCursorRef.current) {
        params.set("cursor_score", String(nextCursorRef.current.cursor_score));
        params.set("cursor_id", nextCursorRef.current.cursor_id);
      }
      const response = await fetch(`/api/search?${params}`);
      if (!response.ok) {
        setHasMore(false);
        return;
      }
      const result = await response.json();
      const newFiles = Array.isArray(result.data) ? result.data : [];
      const newUsers = Array.isArray(result.users) ? result.users : [];

      if (append) {
        setFiles((prev) => {
          const existingIds = new Set(prev.map((f) => f.id));
          const added = newFiles.filter((f: FileType) => !existingIds.has(f.id));
          return [...prev, ...added];
        });
      } else {
        setFiles(newFiles);
        setSearchUsers(newUsers);
      }

      nextCursorRef.current = result.nextCursor ?? null;
      setHasMore(Boolean(result.nextCursor));

      if (result.userActions) {
        setLocalUserActions((prev) => {
          const liked = new Set(prev.likedFileIds);
          const disliked = new Set(prev.dislikedFileIds);
          result.userActions.likedFileIds?.forEach((id: string) => liked.add(id));
          result.userActions.dislikedFileIds?.forEach((id: string) => disliked.add(id));
          return { likedFileIds: liked, dislikedFileIds: disliked };
        });
      }
    } catch {
      setHasMore(false);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setLocalUserActions((prev) => {
      const liked = new Set(globalUserActions.likedFileIds);
      const disliked = new Set(globalUserActions.dislikedFileIds);
      return { likedFileIds: liked, dislikedFileIds: disliked };
    });
  }, [open, globalUserActions]);

  useEffect(() => {
    if (!open) return;
    if (activeTerm) {
      runSearch(activeTerm, false);
    } else {
      setFiles([]);
      setSearchUsers([]);
      setHasMore(false);
      nextCursorRef.current = null;
      fetch("/api/feed")
        .then((r) => r.ok ? r.json() : null)
        .then((result) => {
          if (result && Array.isArray(result.data)) {
            setSuggestions(result.data);
            if (result.userActions) {
              setLocalUserActions((prev) => {
                const liked = new Set(prev.likedFileIds);
                const disliked = new Set(prev.dislikedFileIds);
                result.userActions.likedFileIds?.forEach((id: string) => liked.add(id));
                result.userActions.dislikedFileIds?.forEach((id: string) => disliked.add(id));
                return { likedFileIds: liked, dislikedFileIds: disliked };
              });
            }
          }
        })
        .catch(() => {});
    }
  }, [open, activeTerm, runSearch]);

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const trimmed = inputValue.trim();
      if (!trimmed) return;
      setActiveTerm(trimmed);
    },
    [inputValue]
  );

  const loadMore = useCallback(() => {
    if (isLoadingMore || !hasMore || !activeTerm) return;
    runSearch(activeTerm, true);
  }, [isLoadingMore, hasMore, activeTerm, runSearch]);

  const showSuggestions = activeTerm && files.length === 0 && searchUsers.length === 0;
  const fullSearchHref = activeTerm ? `/search/${encodeURIComponent(activeTerm)}` : "/search";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-2xl sm:max-w-3xl md:max-w-4xl rounded-2xl p-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="px-4 sm:px-6 pt-4 pb-3 shrink-0 border-b border-border">
          <DialogTitle className="text-lg font-semibold">Search</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <form onSubmit={handleSubmit} className="shrink-0 px-4 sm:px-6 pb-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="flex flex-1 items-center gap-2 rounded-full border border-border/30 bg-primary/5 px-4 h-11 sm:h-12 focus-within:ring-2 focus-within:ring-primary/20">
                <SearchIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                <Input
                  autoFocus
                  type="search"
                  enterKeyHint="search"
                  inputMode="search"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Search photos, videos, users"
                  className="h-10 sm:h-11 border-0 px-0 text-base shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/70"
                />
                {inputValue ? (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setInputValue("")}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted/70 text-muted-foreground hover:bg-muted"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              <Button type="submit" className="h-11 sm:h-12 rounded-full px-5 font-medium shrink-0">
                Search
              </Button>
            </div>
          </form>

          <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-6 space-y-6">
            {activeTerm && isLoading && !isLoadingMore ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[1, 2, 3, 4].map((i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            ) : activeTerm ? (
              files.length > 0 || searchUsers.length > 0 ? (
                <>
                  {searchUsers.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold text-foreground">Users</h3>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {searchUsers.map((user) => (
                          <Link
                            key={user.id}
                            to={`/profile/${user.username}`}
                            onClick={() => onOpenChange(false)}
                            className="group flex flex-col items-center p-3 rounded-xl border border-border/30 bg-card hover:bg-accent/50 transition-all"
                          >
                            <div className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-full overflow-hidden mb-2 ring-2 ring-border/50">
                              {user.profile_pic ? (
                                <img
                                  src={getProfilePicUrl(user.profile_pic)}
                                  alt={user.username}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full bg-primary/10 flex items-center justify-center">
                                  <User className="w-6 h-6 text-primary/60" />
                                </div>
                              )}
                            </div>
                            <span className="font-medium text-xs sm:text-sm text-foreground line-clamp-1">
                              {user.username}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {user.file_count} {user.file_count === 1 ? "file" : "files"}
                            </span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {files.length > 0 && (
                    <div className="space-y-3">
                      {searchUsers.length > 0 && (
                        <h3 className="text-sm font-semibold text-foreground">Files</h3>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {files.map((file, index) => (
                          <VideoCard
                            key={file.id ?? index}
                            data={file}
                            index={index}
                            userActions={localUserActions}
                            currentUserId={userId ?? undefined}
                          />
                        ))}
                      </div>
                      {isLoadingMore && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <SkeletonCard />
                          <SkeletonCard />
                        </div>
                      )}
                      {hasMore && !isLoadingMore && (
                        <Button variant="outline" size="sm" className="rounded-full w-full sm:w-auto" onClick={loadMore}>
                          Load more
                        </Button>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border bg-card p-6 text-center">
                    <p className="text-sm font-medium text-foreground">No results found</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Try different keywords or open full search.
                    </p>
                  </div>
                  {showSuggestions && suggestions.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold text-foreground">Suggested</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {suggestions.slice(0, 4).map((file, index) => (
                          <VideoCard
                            key={file.id ?? index}
                            data={file}
                            index={index}
                            userActions={localUserActions}
                            currentUserId={userId ?? undefined}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            ) : (
              suggestions.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">Quick suggestions</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {suggestions.slice(0, 4).map((file, index) => (
                      <VideoCard
                        key={file.id ?? index}
                        data={file}
                        index={index}
                        userActions={localUserActions}
                        currentUserId={userId ?? undefined}
                      />
                    ))}
                  </div>
                </div>
              )
            )}

            <div className="pt-2 border-t border-border">
              <Link
                to={fullSearchHref}
                onClick={() => onOpenChange(false)}
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-4 w-4" />
                Open full search page
              </Link>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
