import { RectangleHorizontal, RectangleVertical } from 'lucide-react';

interface TheaterButtonProps {
  theaterMode: boolean;
  onTheaterModeChange: (active: boolean) => void;
  controlPill?: boolean;
}

export default function TheaterButton({ theaterMode, onTheaterModeChange, controlPill = false }: TheaterButtonProps) {
  return (
    <button
      type="button"
      onClick={() => onTheaterModeChange(!theaterMode)}
      className={
        controlPill
          ? 'rounded-lg p-2 text-white transition-colors hover:bg-white/10'
          : 'rounded-md p-1.5 text-white transition-colors hover:bg-white/10'
      }
      aria-label={theaterMode ? 'Exit theater mode' : 'Theater mode'}
    >
      {theaterMode ? (
        <RectangleVertical className="w-5 h-5" />
      ) : (
        <RectangleHorizontal className="w-5 h-5" />
      )}
    </button>
  );
}
