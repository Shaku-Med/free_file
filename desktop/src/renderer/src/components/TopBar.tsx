import { Bell, Plus, Search, Upload } from "lucide-react";

export function TopBar({ title }: { title: string }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-5 backdrop-blur">
      <h1 className="min-w-[7rem] font-display text-lg font-semibold tracking-tight text-foreground">
        {title}
      </h1>

      <div className="mx-auto flex w-full max-w-xl items-center gap-2 rounded-full border border-border bg-card px-3 py-2">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          type="search"
          placeholder="Search Memories"
          className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:brightness-110"
        >
          <Upload className="size-3.5" />
          Upload
        </button>
        <button
          type="button"
          className="flex size-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition hover:text-foreground"
          aria-label="Create"
        >
          <Plus className="size-4" />
        </button>
        <button
          type="button"
          className="relative flex size-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="size-4" />
          <span className="absolute right-2 top-2 size-1.5 rounded-full bg-primary" />
        </button>
        <div
          className="ml-1 flex size-9 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent"
          aria-hidden
        >
          YA
        </div>
      </div>
    </div>
  );
}
