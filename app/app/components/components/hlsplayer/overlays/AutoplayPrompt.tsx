import { Volume2, VolumeX } from '~/components/icons';
import { usePlayerContext } from '../PlayerContext';

interface AutoplayPromptProps {
  onEnable: () => void;
  onDismiss: () => void;
}

export default function AutoplayPrompt({ onEnable, onDismiss }: AutoplayPromptProps) {
  const { state } = usePlayerContext();

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-neutral-900/95 border border-white/10 rounded-xl p-6 max-w-md mx-4 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          {state.isMuted ? (
            <VolumeX className="w-6 h-6 text-white/60" />
          ) : (
            <Volume2 className="w-6 h-6 text-sky-400" />
          )}
          <h3 className="text-lg font-semibold text-white">Enable Autoplay with Sound</h3>
        </div>
        <p className="text-sm text-white/60 mb-5">
          Allow videos to automatically play with sound. You can change this anytime.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onEnable}
            className="flex-1 bg-primary text-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors font-medium text-sm"
          >
            Enable
          </button>
          <button
            onClick={onDismiss}
            className="px-4 py-2 rounded-lg border border-white/10 text-foreground hover:bg-primary/10 transition-colors text-sm"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
