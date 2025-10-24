import { 
  Star,
  Clock,
  MapPin,
  Image,
  Heart,
  Camera,
  Folder,
  Users
} from "lucide-react";

const albums = [
  { 
    name: "Favorites", 
    count: 24, 
    icon: Star, 
    color: "text-yellow-500",
    bgColor: "bg-yellow-500/10",
    borderColor: "border-yellow-500/20"
  },
  { 
    name: "Recent", 
    count: 2156, 
    icon: Clock, 
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/20"
  },
  { 
    name: "Travel", 
    count: 89, 
    icon: MapPin, 
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/20"
  },
  { 
    name: "People", 
    count: 45, 
    icon: Users, 
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/20"
  },
  { 
    name: "Screenshots", 
    count: 156, 
    icon: Camera, 
    color: "text-orange-500",
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/20"
  },
  { 
    name: "Albums", 
    count: 12, 
    icon: Folder, 
    color: "text-pink-500",
    bgColor: "bg-pink-500/10",
    borderColor: "border-pink-500/20"
  }
];

export default function AlbumCards() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
      {albums.map((album) => (
        <div
          key={album.name}
          className={`group relative bg-card rounded-3xl border ${album.borderColor} p-4 sm:p-5 hover:shadow-xl hover:scale-[1.02] transition-all duration-300 cursor-pointer overflow-hidden`}
        >
          <div className="relative">
            <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl ${album.bgColor} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}>
              <album.icon className={`w-6 h-6 sm:w-7 sm:h-7 ${album.color}`} />
            </div>
            
            <div className="absolute -top-1 -right-1 w-6 h-6 bg-primary rounded-full flex items-center justify-center">
              <Heart className="w-3 h-3 text-primary-foreground" />
            </div>
          </div>
          
          <h3 className="font-semibold text-sm sm:text-base mb-1 group-hover:text-primary transition-colors">
            {album.name}
          </h3>
          <p className="text-xs sm:text-sm text-muted-foreground font-medium">
            {album.count.toLocaleString()} items
          </p>
          
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-3xl" />
        </div>
      ))}
    </div>
  );
}
