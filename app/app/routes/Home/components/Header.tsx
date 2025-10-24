import { Upload, Search, Filter, Grid3X3, List } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

interface HeaderProps {
  totalPhotos: number;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export default function Header({ totalPhotos, searchQuery, onSearchChange }: HeaderProps) {
  return (
    <div className="mb-8 sm:mb-12">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 mb-8">
        <div className="space-y-2">
          <h1 className="text-4xl sm:text-5xl font-bold bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
            Photos
          </h1>
          <p className="text-lg text-muted-foreground">
            {totalPhotos.toLocaleString()} photos in your library
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground group-hover:text-foreground transition-colors" />
            <Input
              type="search"
              placeholder="Search photos..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-80 pl-11 h-12 rounded-2xl border-border/50 bg-background/50 backdrop-blur-sm focus:bg-background transition-all"
            />
          </div>
          
          <Button 
            variant="outline" 
            size="icon" 
            className="h-12 w-12 rounded-2xl hover:bg-accent/50"
          >
            <Filter className="h-4 w-4" />
          </Button>
          
          <div className="flex items-center bg-accent/30 rounded-2xl p-1">
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-10 w-10 rounded-xl hover:bg-background"
            >
              <Grid3X3 className="h-4 w-4" />
            </Button>
            
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-10 w-10 rounded-xl hover:bg-background"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
          
          <Button className="rounded-2xl h-12 px-6 shadow-lg hover:shadow-xl transition-all bg-primary hover:bg-primary/90">
            <Upload className="mr-2 h-4 w-4" />
            Upload Photos
          </Button>
        </div>
      </div>
    </div>
  );
}
