import { RectangleHorizontal, RectangleVertical } from '~/components/icons';
import { cn } from '~/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';

interface TheaterButtonProps {
  theaterMode: boolean;
  onTheaterModeChange: (active: boolean) => void;
  controlPill?: boolean;
}

export default function TheaterButton({ theaterMode, onTheaterModeChange, controlPill = false }: TheaterButtonProps) {
  const label = theaterMode ? 'Exit theater mode' : 'Theater mode';
  return (
    <Tooltip delayDuration={350}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onTheaterModeChange(!theaterMode)}
          className={cn(
            controlPill ? 'rounded-full p-2' : 'rounded-md p-1.5',
            'text-white transition-colors',
            theaterMode ? 'bg-white/20 hover:bg-white/25' : 'hover:bg-white/10',
          )}
          aria-label={label}
        >
          {theaterMode ? (
            <RectangleVertical className="w-5 h-5" />
          ) : (
            <RectangleHorizontal className="w-5 h-5" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
