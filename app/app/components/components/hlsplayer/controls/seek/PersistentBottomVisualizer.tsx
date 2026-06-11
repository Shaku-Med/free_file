import { usePlayerContext } from '../../PlayerContext';
import StemResonanceVisualizer from './StemResonanceVisualizer';

/**
 * Visualizer strip stacked below the control buttons. Requires audio_stems.json;
 * legacy canvas analyser visualizer lives in SeekBarSpectrum.legacy.tsx (not imported).
 * Beat reaction is the border glow (StemGlowBorder, mounted by the player) —
 * confetti retired.
 */
export default function PersistentBottomVisualizer() {
  const { audioVisualizer, audioStems } = usePlayerContext();
  const enabled = audioVisualizer && audioStems != null;

  if (!enabled || !audioStems) return null;

  return (
    <div className="w-full shrink-0 px-3 pb-2 pointer-events-none opacity-75">
      <StemResonanceVisualizer stems={audioStems} />
    </div>
  );
}
