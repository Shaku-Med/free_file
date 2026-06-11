import { Search } from "lucide-react";
import { cn } from "~/lib/utils";

/**
 * YouTube-style suggestion list: plain text completions while typing.
 * The part the user already typed renders normal weight, the completion
 * renders bold — same trick YouTube uses. Video cards live only on the
 * full /search page (reached on Enter or by picking a row).
 */

export interface SearchPanelProps {
  term: string;
  suggestions: string[];
  activeIndex: number;
  onPick: (suggestion: string) => void;
  onHover: (index: number) => void;
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

export function SearchPanel({ term, suggestions, activeIndex, onPick, onHover }: SearchPanelProps) {
  // No suggestions → no dropdown at all (the parent doesn't even render us).
  if (!term || suggestions.length === 0) return null;

  return (
    <ul className="py-2" role="presentation">
      {suggestions.map((suggestion, index) => (
        <li key={suggestion} role="option" aria-selected={index === activeIndex}>
          <button
            type="button"
            // onMouseDown so the pick fires before the input's blur closes the dropdown
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(suggestion);
            }}
            onMouseEnter={() => onHover(index)}
            className={cn(
              "flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-foreground",
              index === activeIndex && "bg-accent",
            )}
          >
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <SuggestionLabel term={term} suggestion={suggestion} />
          </button>
        </li>
      ))}
    </ul>
  );
}
