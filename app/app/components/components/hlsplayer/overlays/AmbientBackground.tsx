import { usePlayerContext } from '../PlayerContext';

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

export default function AmbientBackground() {
  const { file, ambientMode, ambientColors } = usePlayerContext();

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
    : 'radial-gradient(ellipse 140% 140% at 50% 50%, #1e3a5f 0%, #0f172a 50%, #020617 100%)';

  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-hidden z-0"
      aria-hidden
    >
      <div
        className="absolute w-full h-full left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 origin-center"
        style={{
          background: radialBg,
          filter: 'blur(30px)',
          transform: 'translate(-50%, -50%) scale(1.5)',
          opacity: 0.9,
          willChange: 'transform',
        }}
      />
    </div>
  );
}
