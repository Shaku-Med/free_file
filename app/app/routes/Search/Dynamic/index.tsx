import { useCallback, useEffect, useMemo, useState } from "react";
import { data, useLoaderData, useNavigate, Link } from "react-router";
import { Search as SearchIcon, X as XIcon, User } from "lucide-react";

import { useFileContext } from "~/lib/Context/Context";
import type { FileType } from "~/lib/types";
import { ParseFilename } from "~/lib/utils";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "~/components/ui/pagination";
import VideoCard from "~/routes/Home/components/VideoCard";
import db from "~/lib/Database/supabase";
import { filterFilesByAccess } from "~/routes/Api/fun/accessControl";

import { sanitizeSearchQuery } from "~/lib/Security/inputValidation";

export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    let term = request.url.split(`/search/`)[1];
    if (term && term.includes('?')) {
      term = term.split('?')[0];
    }
    if (!term) return data(null, { status: 404 });
    try {
      term = decodeURIComponent(term);
    } catch (decodeError) {
      console.error("Error decoding search term:", decodeError);
      return data(null, { status: 400 });
    }
    const sanitizedTerm = sanitizeSearchQuery(term);
    if (!sanitizedTerm) {
      return data({ url: '', results: [], users: [], filesTotal: 0, usersTotal: 0, currentPage: 1 }, { status: 200 });
    }

    const filesPerPage = 20;
    const usersPerPage = 10;
    const currentPage = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const filesOffset = (currentPage - 1) * filesPerPage;
    const usersOffset = (currentPage - 1) * usersPerPage;
    
    let results: FileType[] | null = null;
    let users: Array<{ id: string; username: string; profile_pic: string; file_count: number }> | null = null;
    let filesTotal = 0;
    let usersTotal = 0;
    
    try {
      if (db) {
        const searchPattern = `%${sanitizedTerm}%`;
        
        const [filesResult, usersResult, filesCountResult, usersCountResult] = await Promise.all([
          db
            .from('files')
            .select('*')
            .or(`filename.ilike.${searchPattern},file_type.ilike.${searchPattern},unique_id.ilike.${searchPattern}`)
            .order('created_at', { ascending: false })
            .range(filesOffset, filesOffset + filesPerPage - 1),
          db
            .from('users')
            .select('id, username, profile_pic')
            .ilike('username', searchPattern)
            .eq('is_memories', false)
            .range(usersOffset, usersOffset + usersPerPage - 1),
          db
            .from('files')
            .select('*', { count: 'exact', head: true })
            .or(`filename.ilike.${searchPattern},file_type.ilike.${searchPattern},unique_id.ilike.${searchPattern}`),
          db
            .from('users')
            .select('*', { count: 'exact', head: true })
            .ilike('username', searchPattern)
            .eq('is_memories', false)
        ]);

        if (filesResult.error) {
          console.error("Supabase files search error:", filesResult.error);
        } else if (Array.isArray(filesResult.data)) {
          const filteredRows = await filterFilesByAccess(request, filesResult.data);
          results = filteredRows as FileType[];
        }

        if (filesCountResult.error) {
          console.error("Supabase files count error:", filesCountResult.error);
        } else {
          filesTotal = filesCountResult.count || 0;
        }

        if (usersCountResult.error) {
          console.error("Supabase users count error:", usersCountResult.error);
        } else {
          usersTotal = usersCountResult.count || 0;
        }

        if (usersResult.error) {
          console.error("Supabase users search error:", usersResult.error);
        } else if (Array.isArray(usersResult.data)) {
          if (usersResult.data.length > 0) {
            const userData = usersResult.data as Array<{ id: string; username: string; profile_pic: string }>;
            const fileCountPromises = userData.map(async (user: { id: string; username: string; profile_pic: string }) => {
              const { count, error: countError } = await db
                .from('files')
                .select('*', { count: 'exact', head: true })
                .eq('owner_id', user.id);

              return {
                id: user.id,
                username: user.username,
                profile_pic: user.profile_pic || '',
                file_count: countError ? 0 : (count || 0)
              };
            });

            users = await Promise.all(fileCountPromises);
          } else {
            users = [];
          }
        }
      }
    } catch (e) {
      console.error("Server search failed:", e);
    }
    return data({ 
      url: sanitizedTerm, 
      results, 
      users: users || [], 
      filesTotal,
      usersTotal,
      currentPage 
    }, { status: 200 });
  } catch (error) {
    console.error("Search loader error:", error);
    return data(null, { status: 500 });
  }
};

const ITEMS_PER_PAGE = 20;


const Search = () => {
  const loaderData = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { userActions, userId } = useFileContext();
  const [suggestions, setSuggestions] = useState<FileType[]>([]);

  const initialTerm = useMemo(() => {
    if (!loaderData || typeof loaderData?.url !== "string") return "";
    return loaderData.url.trim();
  }, [loaderData]);

  const [inputValue, setInputValue] = useState(initialTerm);
  const [activeTerm, setActiveTerm] = useState(initialTerm);

  const currentPage = useMemo(() => {
    if (loaderData && typeof loaderData === 'object' && 'currentPage' in loaderData) {
      return (loaderData as any).currentPage || 1;
    }
    return 1;
  }, [loaderData]);

  const filesTotal = useMemo(() => {
    if (loaderData && typeof loaderData === 'object' && 'filesTotal' in loaderData) {
      return (loaderData as any).filesTotal || 0;
    }
    return 0;
  }, [loaderData]);

  const usersTotal = useMemo(() => {
    if (loaderData && typeof loaderData === 'object' && 'usersTotal' in loaderData) {
      return (loaderData as any).usersTotal || 0;
    }
    return 0;
  }, [loaderData]);

  useEffect(() => {
    setInputValue(initialTerm);
    setActiveTerm(initialTerm);
  }, [initialTerm]);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      try {
        const trimmed = inputValue.trim();
        if (!trimmed) return;
        setActiveTerm(trimmed);
        navigate(`/search/${encodeURIComponent(trimmed)}?page=1`, { replace: false });
      } catch (error) {
        console.error("Error handling search submit:", error);
      }
    },
    [inputValue, navigate]
  );

  const handlePageChange = useCallback((page: number) => {
    navigate(`/search/${encodeURIComponent(activeTerm)}?page=${page}`, { replace: false });
  }, [activeTerm, navigate]);

  const filteredResults = useMemo(() => {
    if (Array.isArray((loaderData as any)?.results)) {
      return ((loaderData as any).results as FileType[]);
    }
    return [];
  }, [loaderData]);

  const filesTotalPages = useMemo(() => {
    return Math.ceil(filesTotal / ITEMS_PER_PAGE);
  }, [filesTotal]);

  const pageNumbers = useMemo(() => {
    if (filesTotalPages <= 1) return [];

    const pages: number[] = [];
    const maxVisible = 5;
    let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let end = start + maxVisible - 1;

    if (end > filesTotalPages) {
      end = filesTotalPages;
      start = Math.max(1, end - maxVisible + 1);
    }

    for (let i = start; i <= end; i += 1) {
      pages.push(i);
    }

    return pages;
  }, [currentPage, filesTotalPages]);

  useEffect(() => {
    const fetchFeed = async () => {
      try {
        const response = await fetch('/api/feed?seen=[]');
        if (response.ok) {
          const result = await response.json();
          if (result.data && Array.isArray(result.data)) {
            setSuggestions(result.data);
          }
        }
      } catch (error) {
        console.error('Error fetching feed for suggestions:', error);
      }
    };

    if (!activeTerm) {
      fetchFeed();
    }
  }, [activeTerm]);

  const searchUsers = useMemo(() => {
    if (loaderData && typeof loaderData === 'object' && 'users' in loaderData) {
      return Array.isArray((loaderData as any).users) ? (loaderData as any).users : [];
    }
    return [];
  }, [loaderData]);

  const showSuggestions = activeTerm && filteredResults.length === 0 && searchUsers.length === 0;

  return (
    <div className="mx-auto w-full max-w-full xl:container py-10">
      <div className="space-y-8">
        {/* <div className="space-y-2">
          <h1 className="text-3xl font-semibold text-foreground">Search</h1>
          {activeTerm ? (
            <p className="text-sm text-muted-foreground">
              Showing results for <span className="font-medium">&ldquo;{activeTerm}&rdquo;</span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Start typing to explore your media library.
            </p>
          )}
        </div> */}

        <form onSubmit={handleSubmit} className="w-full">
          <div className="mx-auto w-full md:max-w-2xl">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex flex-1 items-center gap-2 rounded-full border border-border/30 bg-primary/5 backdrop-blur-xl px-4 h-12 shadow-xs focus-within:ring-4 focus-within:ring-primary/10">
                <SearchIcon className="h-4 w-4 text-muted-foreground" />
                <Input
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
              <Button
                type="submit"
                className="h-12 rounded-full px-6 font-medium shadow-sm"
              >
                Search
              </Button>
            </div>
          </div>
        </form>

        {activeTerm ? (
          (filteredResults.length > 0 || searchUsers.length > 0) ? (
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

              {filteredResults.length > 0 && (
                <div className="space-y-4">
                  {searchUsers.length > 0 && (
                    <h3 className="text-lg font-semibold text-foreground">Files</h3>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                    {filteredResults.map((file: FileType, index: number) => (
                      <VideoCard
                        data={file}
                        index={index + (currentPage - 1) * ITEMS_PER_PAGE}
                        key={index}
                        userActions={userActions}
                        currentUserId={userId || undefined}
                      />
                    ))}
                  </div>
                </div>
              )}

              {filesTotalPages > 1 && (
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#previous"
                        onClick={(event) => {
                          event.preventDefault();
                          if (currentPage > 1) {
                            handlePageChange(currentPage - 1);
                          }
                        }}
                        aria-disabled={currentPage === 1}
                        className={currentPage === 1 ? "pointer-events-none opacity-50" : ""}
                      />
                    </PaginationItem>
                    {pageNumbers[0] > 1 && (
                      <>
                        <PaginationItem>
                          <PaginationLink
                            href="#page-1"
                            onClick={(event) => {
                              event.preventDefault();
                              handlePageChange(1);
                            }}
                          >
                            1
                          </PaginationLink>
                        </PaginationItem>
                        {pageNumbers[0] > 2 && (
                          <PaginationItem>
                            <span className="px-2 text-sm text-muted-foreground">...</span>
                          </PaginationItem>
                        )}
                      </>
                    )}
                    {pageNumbers.map((page) => (
                      <PaginationItem key={page}>
                        <PaginationLink
                          href={`#page-${page}`}
                          isActive={page === currentPage}
                          onClick={(event) => {
                            event.preventDefault();
                            handlePageChange(page);
                          }}
                        >
                          {page}
                        </PaginationLink>
                      </PaginationItem>
                    ))}
                    {pageNumbers[pageNumbers.length - 1] < filesTotalPages && (
                      <>
                        {pageNumbers[pageNumbers.length - 1] < filesTotalPages - 1 && (
                          <PaginationItem>
                            <span className="px-2 text-sm text-muted-foreground">...</span>
                          </PaginationItem>
                        )}
                        <PaginationItem>
                          <PaginationLink
                            href={`#page-${filesTotalPages}`}
                            onClick={(event) => {
                              event.preventDefault();
                              handlePageChange(filesTotalPages);
                            }}
                          >
                            {filesTotalPages}
                          </PaginationLink>
                        </PaginationItem>
                      </>
                    )}
                    <PaginationItem>
                      <PaginationNext
                        href="#next"
                        onClick={(event) => {
                          event.preventDefault();
                          if (currentPage < filesTotalPages) {
                            handlePageChange(currentPage + 1);
                          }
                        }}
                        aria-disabled={currentPage === filesTotalPages}
                        className={currentPage === filesTotalPages ? "pointer-events-none opacity-50" : ""}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
                <h2 className="text-xl font-semibold text-foreground">
                  No results found
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Try adjusting your search or explore these suggestions.
                </p>
              </div>

              {showSuggestions && suggestions.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground">
                    Suggested for you
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                    {suggestions.map((file: FileType, index: number) => (
                      <VideoCard
                        key={file.id || index}
                        data={file}
                        index={index}
                        userActions={userActions}
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
              <h3 className="text-lg font-semibold text-foreground">
                Quick suggestions
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                {suggestions.map((file: FileType, index: number) => (
                  <VideoCard
                    key={file.id || index}
                    data={file}
                    index={index}
                    userActions={userActions}
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