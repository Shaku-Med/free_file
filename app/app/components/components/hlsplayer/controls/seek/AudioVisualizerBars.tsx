import { usePlayerContext } from '../../PlayerContext';
import { useVideoAnalyser } from '../../hooks/useVideoAnalyser';
import SeekBarSpectrum from './SeekBarSpectrum';

/** Web Audio tap + scrolling bars; use inside persistent bottom strip or mini player column. */
export default function AudioVisualizerBars() {
  const { videoRef, audioVisualizer, audioVisualizerStyle, state } = usePlayerContext();
  const analyser = useVideoAnalyser(videoRef, audioVisualizer, state.isLoaded);
  if (!audioVisualizer) return null;
  return <SeekBarSpectrum analyser={analyser} active variant={audioVisualizerStyle} />;
}
