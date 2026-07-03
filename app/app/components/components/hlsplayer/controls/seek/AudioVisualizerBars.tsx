import { usePlayerContext } from '../../PlayerContext';
import StemResonanceVisualizer from './StemResonanceVisualizer';

type Props = {
  /** Kept for call-site compatibility; confetti retired in favor of StemGlowBorder. */
  anchorRef?: unknown;
};

/** Stem-synced SVG wave; mini player column or bottom strip. */
export default function AudioVisualizerBars(_props: Props) {
  const { audioVisualizer, visualizerWave, audioStems } = usePlayerContext();
  // The wave has its own toggle — some users keep only the video bounce.
  const enabled = audioVisualizer && visualizerWave && audioStems != null;

  if (!enabled || !audioStems) return null;

  return <StemResonanceVisualizer stems={audioStems} />;
}
