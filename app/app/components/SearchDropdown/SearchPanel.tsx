import { Link } from "react-router";
import { ExternalLink, Layers, User } from "lucide-react";
import type { FileType } from "~/lib/types";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import VideoCard from "~/routes/Home/components/VideoCard";
import { SignInToSeeMore } from "~/components/SignInWall";
import { Button } from "~/components/ui/button";
import type { SearchUser } from "./useSearchPanel";

function SkeletonCard() {
  return (
    <div className="flex animate-pulse items-center gap-2.5 rounded-lg px-2 py-1.5">
      <div className="aspect-video w-[7rem] shrink-0 rounded-md bg-muted" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-[85%] rounded bg-muted" />
        <div className="h-3 w-[55%] rounded bg-muted" />
      </div>
    </div>
  );
}

function SearchVideoList({
  files,
  localUserActions,
  userId,
}: {
  files: FileType[];
  localUserActions: SearchPanelProps["localUserActions"];
  userId: string | null | undefined;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {files.map((file, index) => (
        <VideoCard
          key={file.id ?? index}
          data={file}
          index={index}
          userActions={localUserActions}
          currentUserId={userId ?? undefined}
          hideActions={{ completely: true, halfway: false }}
          layout="compact"
        />
      ))}
    </div>
  );
}

export interface SearchPanelProps {
  activeTerm: string;
  files: FileType[];
  searchUsers: SearchUser[];
  seriesRoots: FileType[];
  suggestions: FileType[];
  localUserActions: {
    likedFileIds: Set<string>;
    dislikedFileIds: Set<string>;
  };
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  userId: string | null | undefined;
  onLoadMore: () => void;
  onNavigate?: () => void;
}

export function SearchPanel({
  activeTerm,
  files,
  searchUsers,
  seriesRoots,
  suggestions,
  localUserActions,
  isLoading,
  isLoadingMore,
  hasMore,
  userId,
  onLoadMore,
  onNavigate,
}: SearchPanelProps) {
  const showSuggestions =
    activeTerm &&
    files.length === 0 &&
    searchUsers.length === 0 &&
    seriesRoots.length === 0;
  const fullSearchHref = activeTerm ? `/search/${encodeURIComponent(activeTerm)}` : "/search";

  return (
    <div className="space-y-5 p-3 sm:p-4">
      {activeTerm && isLoading && !isLoadingMore ? (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Search results</h3>
          <div className="flex flex-col gap-0.5">
            {[1, 2, 3, 4].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        </div>
      ) : activeTerm ? (
        files.length > 0 || searchUsers.length > 0 || seriesRoots.length > 0 ? (
          <>
            <h3 className="text-sm font-semibold text-foreground">Search results</h3>

            {searchUsers.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Users
                </h4>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {searchUsers.map((user) => (
                    <Link
                      key={user.id}
                      to={`/profile/${user.username}`}
                      onClick={onNavigate}
                      className="group flex flex-col items-center rounded-xl border border-border/30 bg-card p-3 transition-all hover:bg-accent/50"
                    >
                      <div className="relative mb-2 h-14 w-14 overflow-hidden rounded-full ring-2 ring-border/50 sm:h-16 sm:w-16">
                        {user.profile_pic ? (
                          <img
                            src={getProfilePicUrl(user.profile_pic)}
                            alt={user.username}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-primary/10">
                            <User className="h-6 w-6 text-primary/60" />
                          </div>
                        )}
                      </div>
                      <span className="line-clamp-1 text-xs font-medium text-foreground sm:text-sm">
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
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Found in series
                  </h4>
                </div>
                <SearchVideoList
                  files={seriesRoots}
                  localUserActions={localUserActions}
                  userId={userId}
                />
              </div>
            )}

            {files.length > 0 && (
              <div className="space-y-3">
                {(searchUsers.length > 0 || seriesRoots.length > 0) && (
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Files
                  </h4>
                )}
                <SearchVideoList
                  files={files}
                  localUserActions={localUserActions}
                  userId={userId}
                />
                {isLoadingMore && (
                  <div className="flex flex-col gap-0.5">
                    <SkeletonCard />
                    <SkeletonCard />
                  </div>
                )}
                {hasMore && !isLoadingMore ? (
                  userId ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full rounded-full sm:w-auto"
                      onClick={onLoadMore}
                    >
                      Load more
                    </Button>
                  ) : (
                    <SignInToSeeMore />
                  )
                ) : null}
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
                <h4 className="text-sm font-semibold text-foreground">Suggested</h4>
                <SearchVideoList
                  files={suggestions.slice(0, 4)}
                  localUserActions={localUserActions}
                  userId={userId}
                />
              </div>
            )}
          </div>
        )
      ) : suggestions.length > 0 ? (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground">Quick suggestions</h4>
          <SearchVideoList
            files={suggestions.slice(0, 4)}
            localUserActions={localUserActions}
            userId={userId}
          />
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Start typing to search without leaving this page.
        </p>
      )}

      {activeTerm ? (
        <div className="border-t border-border pt-3">
          <Link
            to={fullSearchHref}
            onClick={onNavigate}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-4 w-4" />
            See all results for &ldquo;{activeTerm}&rdquo;
          </Link>
        </div>
      ) : null}
    </div>
  );
}
