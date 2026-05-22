import { useMemo } from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "~/components/ui/tooltip";
import {
  Gamepad2,
  Music,
  Drama,
  GraduationCap,
  Monitor,
  Trophy,
  Newspaper,
  Sparkles,
  Swords,
  Clapperboard,
  Car,
  Palette,
  Trees,
  type LucideIcon,
} from "lucide-react";

const CATEGORY_ICONS: Record<string, { Icon: LucideIcon; tip: string }> = {
  Gaming: { Icon: Gamepad2, tip: "Gaming, Video games, gameplay, esports" },
  Music: { Icon: Music, tip: "Music, Songs, beats, remixes, covers" },
  Entertainment: { Icon: Drama, tip: "Entertainment, Comedy, vlogs, skits" },
  Education: { Icon: GraduationCap, tip: "Education, Tutorials, courses, how-to" },
  Technology: { Icon: Monitor, tip: "Technology, Tech reviews, gadgets, coding" },
  Sports: { Icon: Trophy, tip: "Sports, Highlights, fitness, training" },
  News: { Icon: Newspaper, tip: "News, Breaking news, politics, analysis" },
  Lifestyle: { Icon: Sparkles, tip: "Lifestyle, Fashion, cooking, travel, ASMR" },
  Anime: { Icon: Swords, tip: "Anime, Anime, manga, cosplay" },
  Film: { Icon: Clapperboard, tip: "Film, Movies, trailers, series, reviews" },
  Automotive: { Icon: Car, tip: "Automotive, Cars, racing, mods" },
  Art: { Icon: Palette, tip: "Art, Drawing, painting, digital art" },
  Nature: { Icon: Trees, tip: "Nature, Animals, wildlife, landscapes" },
};

interface CategoryBadgesProps {
  categories?: string[];
  max?: number;
  size?: "sm" | "md";
}

export default function CategoryBadges({ categories, max = 3, size = "md" }: CategoryBadgesProps) {
  const matched = useMemo(() => {
    if (!categories || !Array.isArray(categories)) return [];
    return categories
      .filter((c): c is string => typeof c === "string" && c in CATEGORY_ICONS)
      .slice(0, max);
  }, [categories, max]);

  if (matched.length === 0) return null;

  const boxClass = size === "sm" ? "w-5 h-5" : "w-6 h-6";
  const iconClass = size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5";

  return (
    <div className="absolute left-2 bottom-1 flex items-center gap-1 z-10">
      {matched.map((cat) => {
        const { Icon, tip } = CATEGORY_ICONS[cat];
        return (
          <Tooltip key={cat}>
            <TooltipTrigger  asChild>
              <span className={`flex items-center justify-center ${boxClass} rounded-lg cursor-default select-none text-foreground text-shadow-lg`}>
                <Icon className={iconClass} strokeWidth={2} size={10} />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs max-w-[200px]">
              {tip}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

export { CATEGORY_ICONS };
