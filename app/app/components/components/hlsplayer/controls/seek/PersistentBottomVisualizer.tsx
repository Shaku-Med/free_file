import { usePlayerContext } from '../../PlayerContext';
import StemResonanceVisualizer from './StemResonanceVisualizer';

/**
 * Visualizer strip stacked below the control buttons. Requires audio_stems.json;
 * legacy canvas analyser visualizer lives in SeekBarSpectrum.legacy.tsx (not imported).
 * Beat reaction is the border glow (StemGlowBorder, mounted by the player) —
 * confetti retired.
 */
export default function PersistentBottomVisualizer({
  compact = false,
}: {
  /** Shorter wave + padding for the floating mini dock. */
  compact?: boolean;
}) {
  const { audioVisualizer, visualizerWave, audioStems } = usePlayerContext();
  // Wave has its own toggle so bounce-only users get a clean strip.
  const enabled = audioVisualizer && visualizerWave && audioStems != null;

  if (!enabled || !audioStems) return null;

  return (
    <div
      className={
        compact
          ? 'w-full shrink-0 px-2 pb-1 pointer-events-none opacity-75'
          : 'w-full shrink-0 px-3 pb-2 pointer-events-none opacity-75'
      }
    >
      <StemResonanceVisualizer stems={audioStems} compact={compact} />
    </div>
  );
}
