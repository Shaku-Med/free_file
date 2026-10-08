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

  const showList = open && items.length > 0;

  return (
    // The box keeps its 48px slot in the bar; when it opens it grows downward
    // over the page as one card, the way YouTube's search does now, so the bar
    // itself never changes height.
    <div ref={rootRef} className={cn("relative h-12 w-full min-w-0", className)}>
      <div
        className={cn(
          "absolute inset-x-0 top-0 z-[100000001] overflow-hidden border",
          // The fill switches at once: easing it from the half-transparent hover
          // wash let the page show through the card while it opened.
          "transition-[border-radius,border-color,box-shadow] duration-300 ease-[cubic-bezier(0.2,0,0.6,1)]",
          open
            ? "rounded-[28px] border-border bg-popover text-popover-foreground"
            : "rounded-[24px] border-input bg-background hover:bg-muted/50",
          showList && "shadow-[0_4px_32px_rgb(0_0_0/0.18)]",
        )}
      >
        <form onSubmit={handleSubmit} className="flex h-[46px] min-w-0 items-center gap-1 pl-4 pr-[3px]" role="search">
          <Search
            className={cn(
              "size-5 shrink-0 text-muted-foreground transition-[opacity,width,margin] duration-300",
              open ? "mr-2 opacity-100" : "w-0 opacity-0",
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
            aria-expanded={showList}
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
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-foreground/80 transition-colors hover:bg-accent"
            >
              <X className="size-5" strokeWidth={1.75} />
            </button>
          ) : null}
          <button
            type="submit"
            aria-label="Search"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-accent"
          >
            <Search className="size-5" strokeWidth={2} />
          </button>
        </form>

        {/* Suggestions open inside the same card. The grid row eases from 0fr
            to 1fr, which animates to the list's natural height. */}
        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.2,0,0.6,1)]",
            showList ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div
              id="navbar-search-dropdown"
              role="listbox"
              className={cn(
                "max-h-[min(70dvh,560px)] overflow-y-auto overscroll-contain border-t border-border/60 p-1.5",
                dropdownClassName,
              )}
            >
              {showList ? (
                <SearchPanel
                  term={debouncedTerm || inputValue.trim()}
                  items={items}
                  activeIndex={activeIndex}
                  onPick={goToSearch}
                  onHover={setActiveIndex}
                  onRemoveRecent={removeRecent}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
