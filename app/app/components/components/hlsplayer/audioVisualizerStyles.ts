export const AUDIO_VISUALIZER_STYLES = [
  'bars',
  'mirror',
  'ribbon',
  'pulse',
] as const;

export type AudioVisualizerStyle = (typeof AUDIO_VISUALIZER_STYLES)[number];

export const AUDIO_VISUALIZER_STYLE_LABELS: Record<AudioVisualizerStyle, string> = {
  bars: 'Spectrum bars',
  mirror: 'Mirror',
  ribbon: 'Ribbon wave',
  pulse: 'Pulse bands',
};

export const DEFAULT_AUDIO_VISUALIZER_STYLE: AudioVisualizerStyle = 'bars';

export function parseAudioVisualizerStyle(raw: string | undefined | null): AudioVisualizerStyle {
  if (raw && (AUDIO_VISUALIZER_STYLES as readonly string[]).includes(raw)) {
    return raw as AudioVisualizerStyle;
  }
  return DEFAULT_AUDIO_VISUALIZER_STYLE;
}
