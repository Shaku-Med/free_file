import { RectangleHorizontal, RectangleVertical } from 'lucide-react';

interface TheaterButtonProps {
  theaterMode: boolean;
  onTheaterModeChange: (active: boolean) => void;
}

export default function TheaterButton({ theaterMode, onTheaterModeChange }: TheaterButtonProps) {
  return (
    <button
      onClick={() => onTheaterModeChange(!theaterMode)}
      className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-white"
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
