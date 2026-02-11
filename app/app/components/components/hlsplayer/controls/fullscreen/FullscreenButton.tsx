import { Maximize, Minimize } from 'lucide-react';
import { usePlayerContext } from '../../PlayerContext';

export default function FullscreenButton() {
  const { state, toggleFullscreen } = usePlayerContext();

  return (
    <button
      onClick={toggleFullscreen}
      className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-white"
      aria-label={state.isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
    >
      {state.isFullscreen ? (
        <Minimize className="w-5 h-5" />
      ) : (
        <Maximize className="w-5 h-5" />
      )}
    </button>
  );
}
