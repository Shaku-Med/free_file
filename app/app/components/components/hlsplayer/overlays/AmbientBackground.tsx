import { usePlayerContext } from '../PlayerContext';
import { useHardwareAcceleration } from '~/hooks/useHardwareAcceleration';

function ensureHex(color: string): string {
  if (/^#([0-9A-Fa-f]{3}){1,2}$/.test(color)) return color;
  const m = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (m) {
    const r = parseInt(m[1], 10).toString(16).padStart(2, '0');
    const g = parseInt(m[2], 10).toString(16).padStart(2, '0');
    const b = parseInt(m[3], 10).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  return color;
}

const FALLBACK_FALLBACK_GRADIENT =
  'radial-gradient(ellipse 140% 140% at 50% 50%, #1e3a5f 0%, #0f172a 50%, #020617 100%)';

const SOFT_MASK =
  'radial-gradient(ellipse 80% 80% at 50% 50%, black 15%, rgba(0,0,0,0.4) 55%, transparent 90%)';

export default function AmbientBackground() {
  const { file, ambientMode, ambientColors } = usePlayerContext();
  const hwAccel = useHardwareAcceleration();

  const fileColors = ((): string[] => {
    const c = file?.colors;
    if (Array.isArray(c)) return c.filter((x): x is string => typeof x === 'string');
    return [];
  })();

  if (!ambientMode) return null;

  const colors = ambientColors.length > 0 ? ambientColors : fileColors;
  const hasColors = colors.length > 0;
  const hexColors = hasColors ? colors.slice(0, 5).map(ensureHex) : [];

  const gradientStops = hexColors.length
    ? hexColors
        .map((c, i) => `${c} ${(i / (hexColors.length - 1 || 1)) * 100}%`)
        .join(', ')
    : '';

  const radialBg = hasColors
    ? hexColors.length === 1
      ? hexColors[0]
      : `radial-gradient(ellipse 140% 140% at 50% 50%, ${gradientStops})`
    : FALLBACK_FALLBACK_GRADIENT;

  if (hwAccel) {
    return (
      <div className="absolute inset-0 pointer-events-none z-0" aria-hidden>
        <div
          className="absolute inset-[-20%] origin-center"
          style={{
            background: radialBg,
            filter: 'blur(40px) saturate(1.3)',
            opacity: 0.72,
            willChange: 'transform',
            maskImage: SOFT_MASK,
            WebkitMaskImage: SOFT_MASK,
          }}
        />
      </div>
    );
  }

  // Software-rendered path: filter:blur is CPU-bound and chops on long sessions.
  // Stack soft radial gradients (which the browser rasterizes once per resize) for
  // a similar "glow" look without ever invoking blur.
  const stops = hexColors.length ? hexColors : ['#1e3a5f', '#0f172a', '#020617'];
  const wide =
    stops.length === 1
      ? stops[0]
      : `radial-gradient(ellipse 160% 130% at 50% 50%, ${stops
          .map((c, i, arr) => `${c} ${(i / (arr.length - 1 || 1)) * 100}%`)
          .join(', ')})`;
  const accent =
    stops.length > 1
      ? `radial-gradient(ellipse 70% 60% at 30% 35%, ${stops[0]} 0%, transparent 70%),
         radial-gradient(ellipse 70% 60% at 75% 70%, ${stops[stops.length - 1]} 0%, transparent 70%)`
      : '';

  return (
    <div className="absolute inset-0 pointer-events-none z-0" aria-hidden>
      <div
        className="absolute inset-0"
        style={{
          background: wide,
          opacity: 0.55,
          maskImage: SOFT_MASK,
          WebkitMaskImage: SOFT_MASK,
        }}
      />
      {accent && (
        <div
          className="absolute inset-0 mix-blend-screen"
          style={{
            background: accent,
            opacity: 0.5,
          }}
        />
      )}
    </div>
  );
}
