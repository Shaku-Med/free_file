import { Search, Clock, TrendingUp, X } from "lucide-react";
import { cn, getThumbnailUrl } from "~/lib/utils";
import ImageLoad from "~/routes/Home/components/ImageLoad/ImageLoad";
import type { SearchSuggestion } from "./useSearchPanel";

// Clock rows are this device's history and removable; trending rows are what
// other people search most for the typed prefix.

export interface SearchPanelProps {
  term: string;
  items: SearchSuggestion[];
  activeIndex: number;
  onPick: (suggestion: string) => void;
  onHover: (index: number) => void;
  onRemoveRecent: (query: string) => void;
}

const noopRetry = () => {};

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
  if (kind === "recent") return <Clock className="size-5 shrink-0 text-muted-foreground" aria-hidden />;
  if (kind === "popular") return <TrendingUp className="size-5 shrink-0 text-muted-foreground" aria-hidden />;
  return <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden />;
}

function SuggestionThumbnail({ item }: { item: SearchSuggestion }) {
  const thumb = item.thumb;
  if (!thumb) return null;
  return (
    <span className="ml-2 hidden h-10 w-[4.5rem] shrink-0 overflow-hidden rounded-md bg-muted sm:block">
      <ImageLoad
        link={getThumbnailUrl({
          default_thumbnail: thumb.default_thumbnail,
          thumbnails: null,
          created_at: thumb.created_at,
          unique_id: thumb.unique_id,
          filename: thumb.filename,
        })}
        imageID={`${thumb.unique_id}_suggest`}
        index={0}
        retry={noopRetry}
        className="h-full w-full object-cover"
        quality={10}
        // The suggestion query only ever selects public, non-adult, finished
        // uploads, so nothing gated can reach this list. Passed explicitly so
        // the gate is visible here rather than assumed.
        hasAdultTag={false}
      />
    </span>
  );
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
              className="flex min-w-0 flex-1 items-center gap-4 px-4 py-2 text-left text-[15px] text-foreground"
            >
              <KindIcon kind={item.kind} />
              <SuggestionLabel term={term} suggestion={item.text} />
              <span className="ml-auto" />
              <SuggestionThumbnail item={item} />
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
                aria-label={`Remove ${item.text} from search history`}
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
