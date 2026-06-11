import { isMobile } from 'react-device-detect';
import { usePlayerContext } from '../../PlayerContext';
import StemResonanceVisualizer from './StemResonanceVisualizer';

type Props = {
  /** Kept for call-site compatibility; confetti retired in favor of StemGlowBorder. */
  anchorRef?: unknown;
};

/** Stem-synced SVG wave; mini player column or bottom strip. */
export default function AudioVisualizerBars(_props: Props) {
  const { audioVisualizer, audioStems } = usePlayerContext();
  const enabled = audioVisualizer && !isMobile && audioStems != null;

  if (!enabled || !audioStems) return null;

  return <StemResonanceVisualizer stems={audioStems} />;
}
