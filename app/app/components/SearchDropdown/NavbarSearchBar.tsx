import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useNavigate } from "react-router";
import { Search } from "lucide-react";
import { cn } from "~/lib/utils";
import { SearchPanel } from "./SearchPanel";
import { useSearchPanel } from "./useSearchPanel";

export interface NavbarSearchBarProps {
  className?: string;
  autoFocus?: boolean;
  onClose?: () => void;
  dropdownClassName?: string;
}

/**
 * YouTube-style search bar: typing shows text completions only; Enter (or
 * picking a suggestion) goes to the full /search page where the video cards
 * — and the semantic vector ranking — live. Arrow keys walk the list.
 */
export function NavbarSearchBar({
  className,
  autoFocus,
  onClose,
  dropdownClassName,
}: NavbarSearchBarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const navigate = useNavigate();

  const { inputValue, setInputValue, debouncedTerm, suggestions } = useSearchPanel(open);

  const closeDropdown = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
    onClose?.();
  }, [onClose]);

  const goToSearch = useCallback(
    (query: string) => {
      const q = query.trim();
      if (!q) return;
      navigate(`/search/${encodeURIComponent(q)}`);
      closeDropdown();
      inputRef.current?.blur();
    },
    [navigate, closeDropdown],
  );

  useEffect(() => {
    if (autoFocus) {
      setOpen(true);
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  // Highlight resets whenever a new suggestion list lands.
  useEffect(() => {
    setActiveIndex(-1);
  }, [suggestions]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      setOpen(false);
      setActiveIndex(-1);
    };

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDropdown();
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, closeDropdown]);

  const handleSubmit = useCallback(
    (event?: FormEvent) => {
      event?.preventDefault();
      const picked = activeIndex >= 0 ? suggestions[activeIndex] : undefined;
      const q = (picked ?? inputValue).trim();
      if (q) {
        goToSearch(q);
        return;
      }
      setOpen(true);
      inputRef.current?.focus();
    },
    [activeIndex, suggestions, inputValue, goToSearch],
  );

  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!open) {
          setOpen(true);
          return;
        }
        if (suggestions.length === 0) return;
        event.preventDefault();
        setActiveIndex((prev) => {
          const delta = event.key === "ArrowDown" ? 1 : -1;
          const next = prev + delta;
          if (next < -1) return suggestions.length - 1;
          if (next >= suggestions.length) return -1;
          return next;
        });
      }
    },
    [open, suggestions.length],
  );

  return (
    <div ref={rootRef} className={cn("relative w-full min-w-0", className)}>
      <form
        onSubmit={handleSubmit}
        className="flex w-full min-w-0 max-w-[720px] items-stretch"
        role="search"
      >
        <div
          className={cn(
            "flex min-w-0 flex-1 items-center overflow-hidden rounded-l-full border border-border/60 bg-background pl-4 transition-colors focus-within:border-primary/70 focus-within:ring-1 focus-within:ring-primary/30 dark:border-white/15 dark:bg-background/80",
            open && "border-primary/70 ring-1 ring-primary/30",
          )}
        >
          <input
            ref={inputRef}
            type="search"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setActiveIndex(-1);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search"
            aria-label="Search"
            aria-expanded={open}
            aria-controls="navbar-search-dropdown"
            autoComplete="off"
            enterKeyHint="search"
            className="h-10 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <button
          type="submit"
          aria-label="Search"
          className="flex h-10 w-14 shrink-0 items-center justify-center rounded-r-full border border-l-0 border-border/60 bg-muted/50 text-foreground/90 transition-colors hover:bg-muted dark:border-white/15 dark:bg-muted/30"
        >
          <Search className="h-5 w-5" strokeWidth={2} />
        </button>
      </form>

      {open && inputValue.trim() && suggestions.length > 0 ? (
        <div
          id="navbar-search-dropdown"
          role="listbox"
          className={cn(
            "absolute left-0 right-0 top-[calc(100%+0.35rem)] z-[100000001] overflow-hidden rounded-2xl border border-border/60 bg-background shadow-2xl dark:border-white/10",
            dropdownClassName,
          )}
        >
          <div className="max-h-[min(70dvh,640px)] overflow-y-auto overscroll-contain">
            <SearchPanel
              term={debouncedTerm || inputValue.trim()}
              suggestions={suggestions}
              activeIndex={activeIndex}
              onPick={goToSearch}
              onHover={setActiveIndex}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
