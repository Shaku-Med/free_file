import { STEM_TYPES, type StemType } from './audioStems';
import { themeTokenShades, type ThemeColorToken } from './visualizerPalette';

export type StemConfettiInstruments = Record<StemType, boolean>;

export const DEFAULT_STEM_CONFETTI_INSTRUMENTS: StemConfettiInstruments = {
  kick: true,
  snare: true,
  hihat: true,
  bass: true,
  other: true,
};

/** Each stem maps to a distinct shadcn theme token so colors stay on-brand but readable. */
export const STEM_CONFETTI_META: Record<
  StemType,
  {
    token: ThemeColorToken;
    /** 0 = darker shade, 1 = base, 2 = lighter */
    shadeIndex: 0 | 1 | 2;
    size: number;
    count: number;
    label: string;
  }
> = {
  kick: { token: 'destructive', shadeIndex: 1, size: 1.15, count: 1.2, label: 'Kick' },
  bass: { token: 'primary', shadeIndex: 0, size: 1.0, count: 0.9, label: 'Bass' },
  snare: { token: 'chart-2', shadeIndex: 1, size: 0.95, count: 1.0, label: 'Snare' },
  hihat: { token: 'chart-4', shadeIndex: 2, size: 0.62, count: 0.6, label: 'Hi-hat' },
  other: { token: 'chart-3', shadeIndex: 1, size: 0.8, count: 0.7, label: 'Other' },
};

export type StemConfettiThemePalettes = Record<StemType, { primary: string; secondary: string }>;

export function buildStemConfettiThemePalettes(): StemConfettiThemePalettes {
  const shadeCache = new Map<ThemeColorToken, [string, string, string]>();
  const shadesFor = (token: ThemeColorToken) => {
    let cached = shadeCache.get(token);
    if (!cached) {
      cached = themeTokenShades(token);
      shadeCache.set(token, cached);
    }
    return cached;
  };

  const out = {} as StemConfettiThemePalettes;
  for (const type of STEM_TYPES) {
    const meta = STEM_CONFETTI_META[type];
    const shades = shadesFor(meta.token);
    const primary = shades[meta.shadeIndex] ?? shades[1]!;
    const secondary = shades[Math.max(0, meta.shadeIndex - 1)] ?? shades[0]!;
    out[type] = { primary, secondary };
  }
  return out;
}

export function stemConfettiColors(
  type: StemType,
  palettes: StemConfettiThemePalettes,
): { primary: string; secondary: string } {
  return palettes[type];
}

export function stemConfettiSwatchColor(type: StemType, palettes: StemConfettiThemePalettes): string {
  return stemConfettiColors(type, palettes).primary;
}

/** What the video bounce listens to out of the box: the low end only. */
export const DEFAULT_VIDEO_BOUNCE_INSTRUMENTS: StemConfettiInstruments = {
  kick: true,
  bass: true,
  snare: false,
  hihat: false,
  other: false,
};

/** Parse a per-stem boolean map (JSON string or object) over the given defaults. */
export function parseStemInstrumentMap(
  raw: unknown,
  defaults: StemConfettiInstruments,
): StemConfettiInstruments {
  const out = { ...defaults };
  if (typeof raw === 'string') {
    try {
      return parseStemInstrumentMap(JSON.parse(raw), defaults);
    } catch {
      return out;
    }
  }
  if (!raw || typeof raw !== 'object') return out;
  const data = raw as Record<string, unknown>;
  for (const type of STEM_TYPES) {
    if (typeof data[type] === 'boolean') out[type] = data[type] as boolean;
  }
  return out;
}

export function parseStemConfettiInstruments(raw: unknown): StemConfettiInstruments {
  return parseStemInstrumentMap(raw, DEFAULT_STEM_CONFETTI_INSTRUMENTS);
}

export function serializeStemConfettiInstruments(v: StemConfettiInstruments): string {
  return JSON.stringify(v);
}
