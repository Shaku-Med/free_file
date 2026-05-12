import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { Search as SearchIcon, X as XIcon, User, ExternalLink, Layers } from "lucide-react";
import { useFileContext } from "~/lib/Context/Context";
import type { FileType } from "~/lib/types";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import VideoCard from "~/routes/Home/components/VideoCard";
import { SignInToSeeMore } from "~/components/SignInWall";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Separator } from "~/components/ui/separator";

type SearchUser = { id: string; username: string; profile_pic: string; file_count: number };

/** Matches the brand shown in Navbar (`components/Navbar`). */
const APP_DISPLAY_NAME = "Memories";

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
  const [seriesRoots, setSeriesRoots] = useState<FileType[]>([]);
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
        const sr = Array.isArray(result.seriesRoots) ? result.seriesRoots : [];
        setSeriesRoots(sr as FileType[]);
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
      setSeriesRoots([]);
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

  const showSuggestions =
    activeTerm &&
    files.length === 0 &&
    searchUsers.length === 0 &&
    seriesRoots.length === 0;
  const fullSearchHref = activeTerm ? `/search/${encodeURIComponent(activeTerm)}` : "/search";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        shouldClose
        className={[
          "gap-0 overflow-hidden p-0 flex flex-col",
          // Desktop: centered modal
          "sm:w-[95vw] sm:max-w-3xl md:max-w-4xl sm:max-h-[90vh] sm:rounded-2xl",
          // Mobile: fullscreen, edge-to-edge, no chrome
          "max-sm:top-0 max-sm:left-0 max-sm:translate-x-0 max-sm:translate-y-0",
          "max-sm:w-screen max-sm:h-[100dvh] max-sm:max-w-none max-sm:max-h-[100dvh]",
          "max-sm:rounded-none max-sm:border-0 max-sm:shadow-none",
        ].join(" ")}
      >
        <DialogHeader
          className={[
            "shrink-0 border-b border-border bg-background px-4 py-2.5 text-left sm:px-5",
            // Mobile fullscreen: keep search + close in a real top bar (safe areas, edge insets)
            "max-sm:pt-[calc(env(safe-area-inset-top,0px)+0.625rem)] max-sm:pb-3",
            "max-sm:pl-[max(1rem,env(safe-area-inset-left,0px))] max-sm:pr-[max(1rem,env(safe-area-inset-right,0px))]",
          ].join(" ")}
        >
          <DialogTitle className="sr-only">Search</DialogTitle>
          <div className="flex min-w-0 items-center gap-2 max-sm:gap-2.5">
            <form onSubmit={handleSubmit} className="min-w-0 flex-1">
              <div className="flex h-10 min-w-0 items-center gap-1.5 px-0 max-sm:h-11">
                <SearchIcon className="size-3.5 shrink-0 text-muted-foreground opacity-70 max-sm:size-4" aria-hidden />
                <Input
                  autoFocus
                  type="search"
                  enterKeyHint="search"
                  inputMode="search"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={`Search ${APP_DISPLAY_NAME}`}
                  className="h-9 min-w-0 flex-1 text-muted-foreground rounded-none border-0 bg-transparent px-0 py-0 text-sm shadow-none outline-none placeholder:text-muted-foreground/60 focus:outline-none focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:bg-transparent max-sm:h-10 max-sm:text-base"
                />
              </div>
            </form>
            <Separator orientation="vertical" className="h-6 shrink-0 self-center max-sm:h-8" decorative />
            <DialogClose
              type="button"
              aria-label="Close search"
              className={[
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                "max-sm:h-9 max-sm:w-9",
                "bg-muted/80 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground",
                "outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0",
                "[&_svg]:size-3.5 max-sm:[&_svg]:size-4 [&_svg]:shrink-0",
              ].join(" ")}
            >
              <XIcon aria-hidden />
              <span className="sr-only">Close</span>
            </DialogClose>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div
            className={[
              "min-h-0 flex-1 space-y-6 overflow-y-auto pb-6",
              "px-4 sm:px-6",
              "max-sm:pb-[max(1.5rem,env(safe-area-inset-bottom,0px))]",
              "max-sm:pl-[max(1rem,env(safe-area-inset-left,0px))] max-sm:pr-[max(1rem,env(safe-area-inset-right,0px))]",
            ].join(" ")}
          >
            {activeTerm && isLoading && !isLoadingMore ? (
              <div className="space-y-4">
                <h3 className="pt-4 text-sm font-semibold text-foreground">Search results</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[1, 2, 3, 4].map((i) => (
                    <SkeletonCard key={i} />
                  ))}
                </div>
              </div>
            ) : activeTerm ? (
              files.length > 0 || searchUsers.length > 0 || seriesRoots.length > 0 ? (
                <>
                  <h3 className="pt-4 text-sm font-semibold text-foreground">Search results</h3>
                  {searchUsers.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold text-foreground">Users</h3>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
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

                  {seriesRoots.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-start gap-2">
                        <Layers className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        <div>
                          <h3 className="text-sm font-semibold text-foreground">Series</h3>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Matched an episode title, playlist label (e.g. Season 1), or video in this series.
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {seriesRoots.map((file, index) => (
                          <VideoCard
                            key={file.id ?? index}
                            data={file}
                            index={index}
                            userActions={localUserActions}
                            currentUserId={userId ?? undefined}
                            hideActions={{completely: true, halfway: false}}
                            layout={`shelf`}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {files.length > 0 && (
                    <div className="space-y-3">
                      {(searchUsers.length > 0 || seriesRoots.length > 0) && (
                        <h3 className="text-sm font-semibold text-foreground">Files</h3>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {files.map((file, index) => (
                          <VideoCard
                            key={file.id ?? index}
                            data={file}
                            index={index}
                            userActions={localUserActions}
                            currentUserId={userId ?? undefined}
                            hideActions={{completely: true, halfway: false}}
                            layout={`shelf`}
                          />
                        ))}
                      </div>
                      {isLoadingMore && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <SkeletonCard />
                          <SkeletonCard />
                        </div>
                      )}
                      {hasMore && !isLoadingMore && (
                        userId ? (
                          <Button variant="outline" size="sm" className="rounded-full w-full sm:w-auto" onClick={loadMore}>
                            Load more
                          </Button>
                        ) : (
                          <SignInToSeeMore />
                        )
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
                      <h3 className="text-sm font-semibold text-foreground pt-4">Suggested</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {suggestions.slice(0, 4).map((file, index) => (
                          <VideoCard
                            key={file.id ?? index}
                            data={file}
                            index={index}
                            userActions={localUserActions}
                            currentUserId={userId ?? undefined}
                            hideActions={{completely: true, halfway: false}}
                            layout={`shelf`}
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
                  <h3 className="text-sm font-semibold text-foreground pt-4">Quick suggestions</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {suggestions.slice(0, 4).map((file, index) => (
                      <VideoCard
                        key={file.id ?? index}
                        data={file}
                        index={index}
                        userActions={localUserActions}
                        currentUserId={userId ?? undefined}
                        hideActions={{completely: true, halfway: false}}
                        layout={`shelf`}
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
