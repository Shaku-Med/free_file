import { PLAYLISTS } from "@/data/mock";

export function PlaylistsPage() {
  return (
    <div className="px-5 py-5">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="font-display text-base font-semibold text-foreground">Your playlists</h2>
          <p className="text-xs text-muted-foreground">Organize videos and photos</p>
        </div>
        <button
          type="button"
          className="rounded-full bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground"
        >
          New playlist
        </button>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {PLAYLISTS.map((list) => (
          <button
            key={list.id}
            type="button"
            className="overflow-hidden rounded-2xl border border-border bg-card text-left transition hover:border-primary/40"
          >
            <div
              className="aspect-[16/10]"
              style={{
                background: `
                  linear-gradient(145deg, hsla(${list.hue}, 70%, 50%, 0.4), transparent 60%),
                  #1c2230
                `,
              }}
            />
            <div className="p-3.5">
              <p className="font-semibold text-foreground">{list.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{list.count} items</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
