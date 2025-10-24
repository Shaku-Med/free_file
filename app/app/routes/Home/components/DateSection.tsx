import { Calendar, Loader2 } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import PhotoGrid from "./PhotoGrid";

interface Photo {
  id: number;
  url: string;
  date: string;
  location: string;
  favorite: boolean;
}

interface DateSectionProps {
  date: string;
  photos: Photo[];
  visibleCount: number;
  hasMore: boolean;
  selectedPhotos: number[];
  hoveredPhoto: number | null;
  onToggleSelect: (id: number) => void;
  onHover: (id: number | null) => void;
  onLoadMore: () => void;
  onSentinelRef: (node: HTMLElement | null) => void;
  isLoading: boolean;
}

export default function DateSection({
  date,
  photos,
  visibleCount,
  hasMore,
  selectedPhotos,
  hoveredPhoto,
  onToggleSelect,
  onHover,
  onLoadMore,
  onSentinelRef,
  isLoading
}: DateSectionProps) {
  const displayPhotos = photos.slice(0, visibleCount);

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-6 mb-8 sticky top-20 ios-glass rounded-3xl px-6 py-4 z-10 ios-shadow">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center ios-scale">
            <Calendar className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">{date}</h2>
            <p className="text-sm text-muted-foreground font-medium">
              {photos.length.toLocaleString()} photos
            </p>
          </div>
        </div>
        
        <Badge 
          variant="secondary" 
          className="rounded-2xl px-5 py-2 text-sm font-semibold bg-primary/10 text-primary border-primary/20 ios-shadow"
        >
          {photos.length.toLocaleString()}
        </Badge>
        
        <div className="flex-1 h-px bg-gradient-to-r from-border/50 to-transparent" />
      </div>

      <div ref={onSentinelRef}>
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-6">
              <div className="w-16 h-16 rounded-3xl bg-primary/10 flex items-center justify-center ios-bounce">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
              <p className="text-sm text-muted-foreground font-medium">Loading photos...</p>
            </div>
          </div>
        ) : (
          <>
            <PhotoGrid
              photos={displayPhotos}
              selectedPhotos={selectedPhotos}
              onToggleSelect={onToggleSelect}
              onHover={onHover}
              hoveredPhoto={hoveredPhoto}
            />
            
            {hasMore && (
              <div className="mt-12 text-center">
                <button
                  onClick={onLoadMore}
                  className="inline-flex items-center gap-3 px-8 py-4 bg-primary/10 hover:bg-primary/20 text-primary font-semibold rounded-2xl transition-all duration-200 ios-scale ios-shadow hover:ios-shadow-lg"
                >
                  Load More ({photos.length - visibleCount} remaining)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
