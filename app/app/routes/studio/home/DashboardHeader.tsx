import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Search } from "lucide-react";
import { cleanStudioSearch, STUDIO_SEARCH_MAX } from "~/lib/studio/search";

// No Create button here: the app bar right above already has one.
export function DashboardHeader() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const term = cleanStudioSearch(query);
    navigate(term ? `/brozystudio/posts?q=${encodeURIComponent(term)}` : "/brozystudio/posts");
  };

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
        Channel dashboard
      </h1>
      <form role="search" onSubmit={submit} className="relative w-full min-w-0 sm:w-72">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={STUDIO_SEARCH_MAX}
          placeholder="Search your posts"
          aria-label="Search your posts"
          className="h-9 w-full rounded-lg border border-border/60 bg-card/40 pl-8 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        />
      </form>
    </header>
  );
}
