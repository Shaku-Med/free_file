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
      className="absolute inset-0 pointer-events-none z-0"
      aria-hidden
    >
      <div
        className="absolute inset-[-20%] origin-center"
        style={{
          background: radialBg,
          filter: 'blur(40px) saturate(1.3)',
          opacity: 0.72,
          willChange: 'transform',
          maskImage:
            'radial-gradient(ellipse 80% 80% at 50% 50%, black 15%, rgba(0,0,0,0.4) 55%, transparent 90%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 80% 80% at 50% 50%, black 15%, rgba(0,0,0,0.4) 55%, transparent 90%)',
        }}
      />
    </div>
  );
}
