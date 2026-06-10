export const AUDIO_VISUALIZER_STYLES = [
  'ribbon',
  'bars',
  'mirror',
  'pulse',
  'line',
  'blocks',
  'dots',
  'aurora',
] as const;

export type AudioVisualizerStyle = (typeof AUDIO_VISUALIZER_STYLES)[number];

export const AUDIO_VISUALIZER_STYLE_LABELS: Record<AudioVisualizerStyle, string> = {
  ribbon: 'Ribbon wave',
  bars: 'Spectrum bars',
  mirror: 'Mirror',
  pulse: 'Pulse bands',
  line: 'Oscilloscope',
  blocks: 'Block EQ',
  dots: 'Dot matrix',
  aurora: 'Aurora',
};

export const DEFAULT_AUDIO_VISUALIZER_STYLE: AudioVisualizerStyle = 'ribbon';

export function parseAudioVisualizerStyle(raw: string | undefined | null): AudioVisualizerStyle {
  if (raw && (AUDIO_VISUALIZER_STYLES as readonly string[]).includes(raw)) {
    return raw as AudioVisualizerStyle;
  }
  return DEFAULT_AUDIO_VISUALIZER_STYLE;
}
