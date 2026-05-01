import { RectangleHorizontal, RectangleVertical } from 'lucide-react';
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
          className={
            controlPill
              ? 'rounded-lg p-2 text-white transition-colors hover:bg-white/10'
              : 'rounded-md p-1.5 text-white transition-colors hover:bg-white/10'
          }
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
