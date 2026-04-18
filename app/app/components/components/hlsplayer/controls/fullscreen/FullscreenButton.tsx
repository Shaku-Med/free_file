import { Maximize, Minimize } from 'lucide-react';
import { usePlayerContext } from '../../PlayerContext';

export default function FullscreenButton({ variant }: { variant?: 'mobileOverlay' | 'controlPill' }) {
  const { state, toggleFullscreen } = usePlayerContext();

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggleFullscreen();
      }}
      className={
        variant === 'mobileOverlay'
          ? 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/50 text-white shadow-sm backdrop-blur-sm active:scale-95 transition-transform'
          : variant === 'controlPill'
            ? 'rounded-lg p-2 text-white transition-colors hover:bg-white/10'
            : 'p-1.5 rounded-md hover:bg-white/10 transition-colors text-white'
      }
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
