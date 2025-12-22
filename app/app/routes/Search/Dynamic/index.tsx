import { useCallback, useEffect, useMemo, useState } from "react";
import { data, useLoaderData, useNavigate } from "react-router";
import { Search as SearchIcon, X as XIcon } from "lucide-react";

import { useFileContext } from "~/lib/Context/Context";
import type { FileType } from "~/lib/types";
import { ParseFilename } from "~/lib/utils";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
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
    let term = request.url.split(`/search/`)[1];
    if (!term) return data(null, { status: 404 });
    try {
      term = decodeURIComponent(term);
    } catch (decodeError) {
      console.error("Error decoding search term:", decodeError);
      return data(null, { status: 400 });
    }
    
    // Sanitize search query to prevent injection
    const sanitizedTerm = sanitizeSearchQuery(term);
    if (!sanitizedTerm) {
      return data({ url: '', results: [] }, { status: 200 });
    }
    
    let results: FileType[] | null = null;
    try {
      if (db) {
        // Use parameterized query pattern - Supabase handles this safely
        // But we still sanitize the input
        const searchPattern = `%${sanitizedTerm}%`;
        const { data: rows, error } = await db
          .from('files')
          .select('*')
          .or(`filename.ilike.${searchPattern},file_type.ilike.${searchPattern},unique_id.ilike.${searchPattern}`)
          .order('created_at', { ascending: false })
          .limit(20);
        if (!error && Array.isArray(rows)) {
          const filteredRows = await filterFilesByAccess(request, rows);
          results = filteredRows as FileType[];
        } else if (error) {
          console.error("Supabase search error:", error);
        }
      }
    } catch (e) {
      console.error("Server search failed:", e);
    }
    return data({ url: sanitizedTerm, results }, { status: 200 });
  } catch (error) {
    console.error("Search loader error:", error);
    return data(null, { status: 500 });
  }
};

const ITEMS_PER_PAGE = 20;

const getRandomSuggestions = (items: FileType[], count = 6) => {
  if (!Array.isArray(items) || items.length === 0) return [];
  const pool = [...items];
  const suggestions: FileType[] = [];

  for (let i = pool.length - 1; i > 0; i -= 1) {
    const randomIndex = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[randomIndex]] = [pool[randomIndex], pool[i]];
  }

  for (let i = 0; i < Math.min(count, pool.length); i += 1) {
    suggestions.push(pool[i]);
  }

  return suggestions;
};

const Search = () => {
  const loaderData = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { files } = useFileContext();

  const initialTerm = useMemo(() => {
    if (!loaderData || typeof loaderData?.url !== "string") return "";
    return loaderData.url.trim();
  }, [loaderData]);

  const [inputValue, setInputValue] = useState(initialTerm);
  const [activeTerm, setActiveTerm] = useState(initialTerm);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setInputValue(initialTerm);
    setActiveTerm(initialTerm);
    setCurrentPage(1);
  }, [initialTerm]);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      try {
        const trimmed = inputValue.trim();
        if (!trimmed) return;
        setActiveTerm(trimmed);
        setCurrentPage(1);
        navigate(`/search/${encodeURIComponent(trimmed)}`, { replace: false });
      } catch (error) {
        console.error("Error handling search submit:", error);
      }
    },
    [inputValue, navigate]
  );

  // If server returned results, prefer them; else filter client-side files
  const filteredResults = useMemo(() => {
    if (Array.isArray((loaderData as any)?.results) && (loaderData as any)?.results.length > 0) {
      return ((loaderData as any).results as FileType[]);
    }
    const normalizedTerm = activeTerm.trim().toLowerCase();
    if (!normalizedTerm) return [];

    return files.filter((file) => {
      try {
        const parsedName = ParseFilename(file.filename || "").toLowerCase();
        const fileType = file.file_type?.toLowerCase() ?? "";
        const identifier = file.unique_id?.toLowerCase() ?? "";

        return (
          parsedName.includes(normalizedTerm) ||
          fileType.includes(normalizedTerm) ||
          identifier.includes(normalizedTerm)
        );
      } catch (error) {
        console.error("Error filtering search results:", error);
        return false;
      }
    });
  }, [activeTerm, files]);

  useEffect(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    if (start >= filteredResults.length && currentPage > 1) {
      setCurrentPage(1);
    }
  }, [filteredResults, currentPage]);

  const paginatedResults = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredResults.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredResults, currentPage]);

  const totalPages = Math.ceil(filteredResults.length / ITEMS_PER_PAGE);

  const pageNumbers = useMemo(() => {
    if (totalPages <= 1) return [];

    const pages: number[] = [];
    const maxVisible = 5;
    let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let end = start + maxVisible - 1;

    if (end > totalPages) {
      end = totalPages;
      start = Math.max(1, end - maxVisible + 1);
    }

    for (let i = start; i <= end; i += 1) {
      pages.push(i);
    }

    return pages;
  }, [currentPage, totalPages]);

  const suggestions = useMemo(() => getRandomSuggestions(files), [files]);

  const showSuggestions = activeTerm && filteredResults.length === 0;

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
                  placeholder="Search photos, videos, IDs"
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
          filteredResults.length > 0 ? (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-2">
                {paginatedResults.map((file, index) => (
                  <VideoCard
                    data={file}
                    index={index + (currentPage - 1) * ITEMS_PER_PAGE}
                    key={index}
                  />
                ))}
              </div>

              {totalPages > 1 && (
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#previous"
                        onClick={(event) => {
                          event.preventDefault();
                          setCurrentPage((prev) => Math.max(prev - 1, 1));
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
                              setCurrentPage(1);
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
                            setCurrentPage(page);
                          }}
                        >
                          {page}
                        </PaginationLink>
                      </PaginationItem>
                    ))}
                    {pageNumbers[pageNumbers.length - 1] < totalPages && (
                      <>
                        {pageNumbers[pageNumbers.length - 1] < totalPages - 1 && (
                          <PaginationItem>
                            <span className="px-2 text-sm text-muted-foreground">...</span>
                          </PaginationItem>
                        )}
                        <PaginationItem>
                          <PaginationLink
                            href={`#page-${totalPages}`}
                            onClick={(event) => {
                              event.preventDefault();
                              setCurrentPage(totalPages);
                            }}
                          >
                            {totalPages}
                          </PaginationLink>
                        </PaginationItem>
                      </>
                    )}
                    <PaginationItem>
                      <PaginationNext
                        href="#next"
                        onClick={(event) => {
                          event.preventDefault();
                          setCurrentPage((prev) =>
                            Math.min(prev + 1, totalPages)
                          );
                        }}
                        aria-disabled={currentPage === totalPages}
                        className={currentPage === totalPages ? "pointer-events-none opacity-50" : ""}
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
                  <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-2">
                    {suggestions.map((file, index) => (
                      <VideoCard
                        key={index}
                        data={file}
                        index={index}
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
              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-2">
                {suggestions.map((file, index) => (
                  <VideoCard
                    key={index}
                    data={file}
                    index={index}
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