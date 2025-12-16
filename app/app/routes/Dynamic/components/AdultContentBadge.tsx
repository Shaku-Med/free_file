import { ShieldAlert } from "lucide-react";
import { Badge } from "~/components/ui/badge";

interface AdultContentBadgeProps {
  isPlaying?: boolean;
  className?: string;
}

const AdultContentBadge = ({ isPlaying = false, className = "" }: AdultContentBadgeProps) => {
  if (isPlaying) {
    return null;
  }

  return (
    <div className={`absolute top-1 left-1 z-[100] pointer-events-none ${className}`}>
      <Badge className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide shadow-lg shadow-black/20 ring-1 ring-primary/40 bg-primary/90 backdrop-blur-sm">
        <ShieldAlert className="h-2.5 w-2.5" />
        18+
      </Badge>
    </div>
  );
};

export default AdultContentBadge;

