import { useState, useCallback } from "react";
import { 
  Heart, 
  Share2, 
  Trash2, 
  MoreVertical,
  Check,
  MapPin,
  Star,
  Loader2
} from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

interface Photo {
  id: number;
  url: string;
  date: string;
  location: string;
  favorite: boolean;
}

interface PhotoGridProps {
  photos: Photo[];
  selectedPhotos: number[];
  onToggleSelect: (id: number) => void;
  onHover: (id: number | null) => void;
  hoveredPhoto: number | null;
}

export default function PhotoGrid({ 
  photos, 
  selectedPhotos, 
  onToggleSelect, 
  onHover, 
  hoveredPhoto 
}: PhotoGridProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
      {photos.map((photo) => (
        <PhotoCard
          key={photo.id}
          photo={photo}
          isSelected={selectedPhotos.includes(photo.id)}
          isHovered={hoveredPhoto === photo.id}
          onHover={onHover}
          onToggleSelect={onToggleSelect}
        />
      ))}
    </div>
  );
}

function PhotoCard({ 
  photo, 
  isSelected, 
  isHovered, 
  onHover, 
  onToggleSelect 
}: {
  photo: Photo;
  isSelected: boolean;
  isHovered: boolean;
  onHover: (id: number | null) => void;
  onToggleSelect: (id: number) => void;
}) {
  const [imageLoaded, setImageLoaded] = useState(false);

  return (
    <div
      className="group relative aspect-square rounded-2xl overflow-hidden bg-primary/5 cursor-pointer transition-all duration-300 ios-scale ios-shadow hover:ios-shadow-lg"
      onMouseEnter={() => onHover(photo.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onToggleSelect(photo.id)}
    >
      {!imageLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-primary/5">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
      
      <img
        src={photo.url}
        alt="Photo"
        loading="lazy"
        onLoad={() => setImageLoaded(true)}
        className={`w-full h-full object-cover transition-all duration-500 ${
          imageLoaded ? 'opacity-100' : 'opacity-0'
        } ${isHovered ? 'scale-105' : 'scale-100'}`}
      />

      <div className={`absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent transition-all duration-300 ${
        isHovered || isSelected ? 'opacity-100' : 'opacity-0'
      }`}>
        <div className="absolute top-3 left-3">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 ios-bounce ${
              isSelected
                ? 'bg-primary border-2 border-primary ios-shadow-lg'
                : 'bg-background/80 backdrop-blur-md border-2 border-white/80 ios-shadow'
            }`}
          >
            {isSelected && (
              <Check className="w-4 h-4 text-primary-foreground" />
            )}
          </div>
        </div>

        <div className="absolute top-3 right-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 rounded-full bg-background/80 backdrop-blur-md hover:bg-background/90 border border-white/30 ios-scale ios-shadow"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-2xl w-48 ios-glass border-0 ios-shadow-lg">
              <DropdownMenuItem className="rounded-xl ios-scale">
                <Share2 className="mr-3 h-4 w-4" />
                Share
              </DropdownMenuItem>
              <DropdownMenuItem className="rounded-xl ios-scale">
                <Heart className="mr-3 h-4 w-4" />
                Add to favorites
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border/20" />
              <DropdownMenuItem className="rounded-xl text-destructive focus:text-destructive ios-scale">
                <Trash2 className="mr-3 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {photo.favorite && (
          <div className="absolute top-3 right-14">
            <div className="w-8 h-8 rounded-full bg-background/80 backdrop-blur-md flex items-center justify-center border border-white/30 ios-shadow">
              <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
            </div>
          </div>
        )}

        <div className="absolute bottom-0 left-0 right-0 p-4">
          <div className="flex items-center gap-2 text-white">
            <MapPin className="w-4 h-4 opacity-90" />
            <span className="font-semibold text-sm truncate">{photo.location}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
