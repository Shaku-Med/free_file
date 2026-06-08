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

export function NavbarSearchBar({
  className,
  autoFocus,
  onClose,
  dropdownClassName,
}: NavbarSearchBarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const panel = useSearchPanel(open);
  const {
    inputValue,
    setInputValue,
    debouncedTerm,
    files,
    searchUsers,
    seriesRoots,
    suggestions,
    localUserActions,
    hasMore,
    isLoading,
    isLoadingMore,
    loadMore,
    userId,
  } = panel;

  const closeDropdown = useCallback(() => {
    setOpen(false);
    onClose?.();
  }, [onClose]);

  useEffect(() => {
    if (autoFocus) {
      setOpen(true);
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      setOpen(false);
    };

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        onClose?.();
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
  }, [open, onClose]);

  const handleSubmit = useCallback((event?: FormEvent) => {
    event?.preventDefault();
    const q = inputValue.trim();
    if (q) {
      navigate(`/search/${encodeURIComponent(q)}`);
      closeDropdown();
      inputRef.current?.blur();
      return;
    }
    setOpen(true);
    inputRef.current?.focus();
  }, [inputValue, navigate, closeDropdown]);

  const handleInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "Enter") {
      setOpen(true);
    }
  }, []);

  const showDropdown = open;

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
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search"
            aria-label="Search"
            aria-expanded={showDropdown}
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

      {showDropdown ? (
        <div
          id="navbar-search-dropdown"
          role="listbox"
          className={cn(
            "absolute left-0 right-0 top-[calc(100%+0.35rem)] z-[100000001] overflow-hidden rounded-2xl border border-border/60 bg-background shadow-2xl dark:border-white/10",
            dropdownClassName,
          )}
        >
          <div className="max-h-[min(70dvh,640px)] overflow-y-auto overscroll-contain">
            {inputValue.trim() !== debouncedTerm && inputValue.trim() ? (
              <p className="border-b border-border/50 px-4 py-2 text-xs text-muted-foreground">
                Searching&hellip;
              </p>
            ) : null}
            <SearchPanel
              activeTerm={debouncedTerm}
              files={files}
              searchUsers={searchUsers}
              seriesRoots={seriesRoots}
              suggestions={suggestions}
              localUserActions={localUserActions}
              isLoading={isLoading}
              isLoadingMore={isLoadingMore}
              hasMore={hasMore}
              userId={userId}
              onLoadMore={loadMore}
              onNavigate={closeDropdown}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
