import { isMobile } from 'react-device-detect';
import { usePlayerContext } from '../../PlayerContext';
import { useVideoAnalyser } from '../../hooks/useVideoAnalyser';
import SeekBarSpectrum from './SeekBarSpectrum';
import BassConfetti from './BassConfetti';

/**
 * Visualizer strip stacked below the control buttons. Owns the single shared
 * analyser node and feeds both the spectrum bars and the bass-kick confetti.
 */
export default function PersistentBottomVisualizer() {
  const { videoRef, audioVisualizer, audioVisualizerStyle, state } = usePlayerContext();
  const enabled = audioVisualizer && !isMobile;
  const analyser = useVideoAnalyser(videoRef, enabled, state.isLoaded);

  if (!enabled) return null;

  return (
    <>
      {/* Confetti sits outside the dimmed strip so the pops read clearly. */}
      <BassConfetti analyser={analyser} />
      <div className="w-full shrink-0 px-3 pb-2 pointer-events-none opacity-75">
        <SeekBarSpectrum analyser={analyser} active variant={audioVisualizerStyle} />
      </div>
    </>
  );
}
