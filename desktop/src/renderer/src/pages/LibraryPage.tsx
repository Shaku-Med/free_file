import { LIBRARY_SECTIONS } from "@/data/mock";
import { MediaCard } from "@/components/MediaCard";

export function LibraryPage() {
  return (
    <div className="space-y-8 px-5 py-5">
      {LIBRARY_SECTIONS.map((section) => (
        <section key={section.title}>
          <div className="mb-3 flex items-end justify-between">
            <h2 className="font-display text-base font-semibold text-foreground">{section.title}</h2>
            <button type="button" className="text-xs font-medium text-primary hover:underline">
              See all
            </button>
          </div>
          <div className="feed-grid">
            {section.items.map((item) => (
              <MediaCard key={`${section.title}-${item.id}`} item={item} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
