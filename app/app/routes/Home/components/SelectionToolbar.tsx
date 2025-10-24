import { 
  Share2,
  Heart,
  Trash2,
  X,
  Download,
  Archive,
  Tag
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";

interface SelectionToolbarProps {
  selectedCount: number;
  onClearSelection: () => void;
}

export default function SelectionToolbar({ selectedCount, onClearSelection }: SelectionToolbarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 duration-300">
      <div className="ios-glass rounded-3xl border-0 ios-shadow-lg px-8 py-5 flex items-center gap-6 min-w-[400px]">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-primary rounded-2xl flex items-center justify-center ios-bounce">
            <span className="text-primary-foreground font-bold text-sm">
              {selectedCount}
            </span>
          </div>
          <span className="text-sm font-semibold">
            {selectedCount === 1 ? 'photo' : 'photos'} selected
          </span>
        </div>
        
        <Separator orientation="vertical" className="h-8 bg-border/30" />
        
        <div className="flex items-center gap-3">
          <Button 
            size="sm" 
            variant="ghost" 
            className="rounded-2xl h-10 px-5 hover:bg-primary/10 ios-scale"
          >
            <Share2 className="h-4 w-4 mr-2" />
            Share
          </Button>
          
          <Button 
            size="sm" 
            variant="ghost" 
            className="rounded-2xl h-10 px-5 hover:bg-primary/10 ios-scale"
          >
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>
          
          <Button 
            size="sm" 
            variant="ghost" 
            className="rounded-2xl h-10 px-5 hover:bg-primary/10 ios-scale"
          >
            <Heart className="h-4 w-4 mr-2" />
            Favorite
          </Button>
          
          <Button 
            size="sm" 
            variant="ghost" 
            className="rounded-2xl h-10 px-5 hover:bg-primary/10 ios-scale"
          >
            <Tag className="h-4 w-4 mr-2" />
            Tag
          </Button>
          
          <Button 
            size="sm" 
            variant="ghost" 
            className="rounded-2xl h-10 px-5 hover:bg-primary/10 ios-scale"
          >
            <Archive className="h-4 w-4 mr-2" />
            Archive
          </Button>
          
          <Separator orientation="vertical" className="h-8 bg-border/30" />
          
          <Button 
            size="sm" 
            variant="ghost" 
            className="rounded-2xl h-10 px-5 text-destructive hover:text-destructive hover:bg-destructive/10 ios-scale"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
          
          <Button 
            size="sm" 
            variant="ghost" 
            className="rounded-2xl h-10 w-10 p-0 hover:bg-primary/10 ios-scale"
            onClick={onClearSelection}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
