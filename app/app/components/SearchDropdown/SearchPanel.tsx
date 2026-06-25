import { Search, Clock, TrendingUp, X } from "lucide-react";
import { cn } from "~/lib/utils";
import type { SearchSuggestion } from "./useSearchPanel";

/**
 * YouTube-style suggestion list. Empty box shows recent (clock, removable) +
 * popular (trending) queries; typing shows matches (search) with the completion
 * bolded. Video cards live only on the full /search page.
 */

export interface SearchPanelProps {
  term: string;
  items: SearchSuggestion[];
  activeIndex: number;
  onPick: (suggestion: string) => void;
  onHover: (index: number) => void;
  onRemoveRecent: (query: string) => void;
}

function SuggestionLabel({ term, suggestion }: { term: string; suggestion: string }) {
  const lowerTerm = term.toLowerCase();
  if (lowerTerm && suggestion.toLowerCase().startsWith(lowerTerm)) {
    return (
      <span className="min-w-0 truncate">
        {suggestion.slice(0, term.length)}
        <span className="font-semibold">{suggestion.slice(term.length)}</span>
      </span>
    );
  }
  return <span className="min-w-0 truncate font-semibold">{suggestion}</span>;
}

function KindIcon({ kind }: { kind: SearchSuggestion["kind"] }) {
  if (kind === "recent") return <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />;
  if (kind === "popular") return <TrendingUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />;
  return <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />;
}

export function SearchPanel({ term, items, activeIndex, onPick, onHover, onRemoveRecent }: SearchPanelProps) {
  if (items.length === 0) return null;

  return (
    <ul className="py-2" role="presentation">
      {items.map((item, index) => (
        <li key={`${item.kind}-${item.text}`} role="option" aria-selected={index === activeIndex}>
          <div
            className={cn(
              "group flex w-full items-center gap-3 pr-2",
              index === activeIndex && "bg-accent",
            )}
          >
            <button
              type="button"
              // onMouseDown so the pick fires before the input's blur closes the dropdown
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(item.text);
              }}
              onMouseEnter={() => onHover(index)}
              className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2 text-left text-sm text-foreground"
            >
              <KindIcon kind={item.kind} />
              <SuggestionLabel term={term} suggestion={item.text} />
            </button>
            {item.kind === "recent" && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onRemoveRecent(item.text);
                }}
                className="shrink-0 rounded-full p-1 text-xs font-medium text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                aria-label={`Remove ${item.text} from recent searches`}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
