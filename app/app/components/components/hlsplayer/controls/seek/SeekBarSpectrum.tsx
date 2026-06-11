import type { AudioVisualizerStyle } from '../../audioVisualizerStyles';

/**
 * MIGHT NEED LATER — DO NOT TOUCH.
 * Legacy canvas + AnalyserNode visualizer preserved in ./SeekBarSpectrum.legacy.tsx
 * (not imported). Replaced by StemResonanceVisualizer + audio_stems.json.
 */
type Props = {
  analyser: AnalyserNode | null;
  active: boolean;
  variant: AudioVisualizerStyle;
};

export default function SeekBarSpectrum(_props: Props) {
  return null;
}
