import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useNavigate } from "react-router";
import { Search, X } from "lucide-react";
import { cn } from "~/lib/utils";
import { SearchPanel } from "./SearchPanel";
import { useSearchPanel } from "./useSearchPanel";

export interface NavbarSearchBarProps {
  className?: string;
  autoFocus?: boolean;
  onClose?: () => void;
  dropdownClassName?: string;
}

// Enter or picking a suggestion goes to /search, where the video cards and the
// semantic ranking live. Arrow keys walk the list.
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

  const { inputValue, setInputValue, debouncedTerm, items, recordSearch, removeRecent } = useSearchPanel(open);

  const closeDropdown = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
    onClose?.();
  }, [onClose]);

  const goToSearch = useCallback(
    (query: string) => {
      const q = query.trim();
      if (!q) return;
      recordSearch(q);
      navigate(`/search/${encodeURIComponent(q)}`);
      closeDropdown();
      inputRef.current?.blur();
    },
    [navigate, closeDropdown, recordSearch],
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
  }, [items]);

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
      const picked = activeIndex >= 0 ? items[activeIndex]?.text : undefined;
      const q = (picked ?? inputValue).trim();
      if (q) {
        goToSearch(q);
        return;
      }
      setOpen(true);
      inputRef.current?.focus();
    },
    [activeIndex, items, inputValue, goToSearch],
  );

  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!open) {
          setOpen(true);
          return;
        }
        if (items.length === 0) return;
        event.preventDefault();
        setActiveIndex((prev) => {
          const delta = event.key === "ArrowDown" ? 1 : -1;
          const next = prev + delta;
          if (next < -1) return items.length - 1;
          if (next >= items.length) return -1;
          return next;
        });
      }
    },
    [open, items.length],
  );

  return (
    <div ref={rootRef} className={cn("relative w-full min-w-0", className)}>
      {/* YouTube's box: the field and the search button are one joined pill,
          rounded on the outside ends only. The magnifier slides in on the left
          while the box is live. */}
      <form onSubmit={handleSubmit} className="flex h-10 w-full min-w-0 items-stretch" role="search">
        <div
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 rounded-l-full border border-r-0 border-input bg-background pl-4 pr-1 shadow-inner transition-colors dark:shadow-none",
            "focus-within:border-primary/70",
            open && "border-primary/70",
          )}
        >
          <Search
            className={cn(
              "size-5 shrink-0 text-muted-foreground transition-[opacity,width]",
              open ? "opacity-100" : "w-0 opacity-0",
            )}
            strokeWidth={2}
            aria-hidden
          />
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
            className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none"
          />
          {inputValue ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setInputValue("");
                setActiveIndex(-1);
                inputRef.current?.focus();
              }}
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-foreground/80 transition-colors hover:bg-accent"
            >
              <X className="size-5" strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
        <button
          type="submit"
          aria-label="Search"
          className="flex w-16 shrink-0 items-center justify-center rounded-r-full border border-input bg-muted text-foreground/90 transition-colors hover:bg-accent"
        >
          <Search className="size-5" strokeWidth={2} />
        </button>
      </form>

      {open && items.length > 0 ? (
        <div
          id="navbar-search-dropdown"
          role="listbox"
          className={cn(
            "absolute left-0 right-16 top-[calc(100%+0.25rem)] z-[100000001] overflow-hidden rounded-xl border border-border/60 bg-background py-1 shadow-2xl dark:border-white/10",
            dropdownClassName,
          )}
        >
          <div className="max-h-[min(70dvh,640px)] overflow-y-auto overscroll-contain">
            <SearchPanel
              term={debouncedTerm || inputValue.trim()}
              items={items}
              activeIndex={activeIndex}
              onPick={goToSearch}
              onHover={setActiveIndex}
              onRemoveRecent={removeRecent}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
