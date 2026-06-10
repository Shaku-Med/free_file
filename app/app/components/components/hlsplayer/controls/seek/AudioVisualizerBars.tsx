import type { RefObject } from 'react';
import { isMobile } from 'react-device-detect';
import { usePlayerContext } from '../../PlayerContext';
import { useVideoAnalyser } from '../../hooks/useVideoAnalyser';
import SeekBarSpectrum from './SeekBarSpectrum';
import BassConfetti from './BassConfetti';

type Props = {
  /** Mini player video shell — confetti tracks this while dragging/resizing. */
  anchorRef?: RefObject<HTMLElement | null>;
};

/** Web Audio tap + scrolling bars; use inside persistent bottom strip or mini player column. */
export default function AudioVisualizerBars({ anchorRef }: Props) {
  const { videoRef, audioVisualizer, audioVisualizerStyle, visualizerConfetti, state } =
    usePlayerContext();
  const enabled = audioVisualizer && !isMobile;
  const analyser = useVideoAnalyser(videoRef, enabled, state.isLoaded);
  if (!enabled) return null;
  return (
    <>
      {visualizerConfetti ? <BassConfetti analyser={analyser} anchorRef={anchorRef} /> : null}
      <SeekBarSpectrum analyser={analyser} active variant={audioVisualizerStyle} />
    </>
  );
}
