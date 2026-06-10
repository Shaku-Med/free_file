export const CONFETTI_STYLES = [
  'instruments',
  'classic',
  'sparkle',
  'streamers',
  'shapes',
  'bubbles',
] as const;

export type ConfettiStyle = (typeof CONFETTI_STYLES)[number];

export const CONFETTI_STYLE_LABELS: Record<ConfettiStyle, string> = {
  instruments: 'By instrument',
  classic: 'Classic burst',
  sparkle: 'Sparkle',
  streamers: 'Streamers',
  shapes: 'Mixed shapes',
  bubbles: 'Bubbles',
};

export const CONFETTI_AMOUNTS = ['light', 'normal', 'heavy'] as const;

export type ConfettiAmount = (typeof CONFETTI_AMOUNTS)[number];

export const CONFETTI_AMOUNT_LABELS: Record<ConfettiAmount, string> = {
  light: 'Light',
  normal: 'Normal',
  heavy: 'Heavy',
};

export const CONFETTI_SPREADS = ['subtle', 'normal', 'wide'] as const;

export type ConfettiSpread = (typeof CONFETTI_SPREADS)[number];

export const CONFETTI_SPREAD_LABELS: Record<ConfettiSpread, string> = {
  subtle: 'Subtle',
  normal: 'Normal',
  wide: 'Wide',
};

export const DEFAULT_CONFETTI_STYLE: ConfettiStyle = 'classic';
export const DEFAULT_CONFETTI_AMOUNT: ConfettiAmount = 'light';
export const DEFAULT_CONFETTI_SPREAD: ConfettiSpread = 'subtle';

export function parseConfettiStyle(raw: string | undefined | null): ConfettiStyle {
  if (raw && (CONFETTI_STYLES as readonly string[]).includes(raw)) {
    return raw as ConfettiStyle;
  }
  return DEFAULT_CONFETTI_STYLE;
}

export function parseConfettiAmount(raw: string | undefined | null): ConfettiAmount {
  if (raw && (CONFETTI_AMOUNTS as readonly string[]).includes(raw)) {
    return raw as ConfettiAmount;
  }
  return DEFAULT_CONFETTI_AMOUNT;
}

export function parseConfettiSpread(raw: string | undefined | null): ConfettiSpread {
  if (raw && (CONFETTI_SPREADS as readonly string[]).includes(raw)) {
    return raw as ConfettiSpread;
  }
  return DEFAULT_CONFETTI_SPREAD;
}

export type ConfettiRuntimeConfig = {
  maxParticles: number;
  countMul: number;
  cooldownMul: number;
  spillTop: number;
  spillSide: number;
  spillBottom: number;
};

const BASE_SPILL = { top: 48, side: 40, bottom: 72 };

export function confettiRuntimeConfig(
  amount: ConfettiAmount,
  spread: ConfettiSpread,
): ConfettiRuntimeConfig {
  const spreadMul =
    spread === 'subtle' ? 0.65 : spread === 'wide' ? 1.45 : 1;
  const amountCfg =
    amount === 'light'
      ? { maxParticles: 110, countMul: 0.55, cooldownMul: 1.25 }
      : amount === 'heavy'
        ? { maxParticles: 360, countMul: 1.55, cooldownMul: 0.72 }
        : { maxParticles: 220, countMul: 1, cooldownMul: 1 };

  return {
    ...amountCfg,
    spillTop: Math.round(BASE_SPILL.top * spreadMul),
    spillSide: Math.round(BASE_SPILL.side * spreadMul),
    spillBottom: Math.round(BASE_SPILL.bottom * spreadMul),
  };
}

/** Distance from player bottom to confetti spawn line (visualizer strip). */
export const CONFETTI_SPAWN_FROM_BOTTOM_PX = 42;
