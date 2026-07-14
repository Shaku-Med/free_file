import { Minus, Square, X } from "lucide-react";

export function TitleBar() {
  return (
    <header className="app-drag flex h-10 shrink-0 items-center border-b border-border bg-sidebar px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="flex size-5 items-center justify-center rounded-md bg-primary text-[10px] font-bold text-primary-foreground">
          M
        </div>
        <span className="truncate font-display text-sm font-semibold tracking-tight text-foreground">
          Memories
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Desktop
        </span>
      </div>
      <div className="app-no-drag flex items-center gap-0.5">
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
          onClick={() => void window.memoriesDesktop.minimize()}
          aria-label="Minimize"
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
          onClick={() => void window.memoriesDesktop.maximize()}
          aria-label="Maximize"
        >
          <Square className="size-3" />
        </button>
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-danger/20 hover:text-danger"
          onClick={() => void window.memoriesDesktop.close()}
          aria-label="Close"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </header>
  );
}
