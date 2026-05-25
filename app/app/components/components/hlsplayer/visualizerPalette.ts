/**
 * Visualizer colors: derived only from theme `var(--primary)` (resolved to computed RGB).
 */

/** Resolve `var(--primary)` to `rgb(...)` / `rgba(...)` the browser understands on canvas. */
export function resolvePrimaryColorForCanvas(): string {
  if (typeof document === 'undefined') return 'rgb(99, 102, 241)';
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:fixed;left:-9999px;top:0;color:var(--primary);visibility:hidden;pointer-events:none';
  document.documentElement.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  document.documentElement.removeChild(probe);
  if (resolved && resolved !== 'rgba(0, 0, 0, 0)') return resolved;
  return 'rgb(99, 102, 241)';
}

/** Parse CSS colors (incl. oklch from theme) to RGBA for canvas. */
export function cssColorToRgba(css: string): { r: number; g: number; b: number; a: number } | null {
  if (typeof document === 'undefined' || !css.trim()) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.fillStyle = '#000000';
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  } catch {
    return null;
  }
}

export function applyAlphaToCssColor(color: string, alpha: number): string {
  const p = cssColorToRgba(color);
  if (!p) return `rgba(128,128,128,${alpha})`;
  return `rgba(${p.r},${p.g},${p.b},${Math.min(1, alpha * p.a)})`;
}

function rgbaStopToString(s: { r: number; g: number; b: number; a: number }): string {
  return `rgba(${s.r},${s.g},${s.b},${s.a})`;
}

/**
 * 6 string stops for horizontal lerp  all from primary (darker / base / lighter) so scroll stays smooth.
 */
export function buildPrimaryVisualizerPalette(): string[] {
  const resolved = resolvePrimaryColorForCanvas();
  const c = cssColorToRgba(resolved) ?? { r: 99, g: 102, b: 241, a: 1 };
  const darker = {
    r: Math.max(0, Math.round(c.r * 0.72)),
    g: Math.max(0, Math.round(c.g * 0.72)),
    b: Math.max(0, Math.round(c.b * 0.72)),
    a: c.a,
  };
  const lighter = {
    r: Math.min(255, Math.round(c.r + (255 - c.r) * 0.38)),
    g: Math.min(255, Math.round(c.g + (255 - c.g) * 0.38)),
    b: Math.min(255, Math.round(c.b + (255 - c.b) * 0.38)),
    a: c.a,
  };
  const mid = { r: c.r, g: c.g, b: c.b, a: c.a };
  return [
    rgbaStopToString(darker),
    rgbaStopToString(mid),
    rgbaStopToString(lighter),
    rgbaStopToString(mid),
    rgbaStopToString(darker),
    rgbaStopToString(lighter),
  ];
}

export function paletteColorAtIndex(palette: string[], index: number, total: number): string {
  if (palette.length === 0) return 'rgb(128,128,128)';
  if (total <= 1) return palette[0]!;
  const t = index / (total - 1);
  const j = Math.min(palette.length - 1, Math.round(t * (palette.length - 1)));
  return palette[j]!;
}

export type RgbaStop = { r: number; g: number; b: number; a: number };

/** Pre-parse palette once per theme change (avoid per-column canvas work). */
export function paletteToRgbStops(palette: string[]): RgbaStop[] {
  if (palette.length === 0) return [{ r: 128, g: 128, b: 128, a: 1 }];
  return palette.map((p) => cssColorToRgba(p) ?? { r: 128, g: 128, b: 128, a: 1 });
}

/**
 * Smooth color along palette for t in [0, 1] (left → right).
 */
export function lerpPaletteStops(stops: RgbaStop[], t: number): string {
  if (stops.length === 0) return 'rgba(128,128,128,1)';
  if (stops.length === 1) {
    const s = stops[0]!;
    return `rgba(${s.r},${s.g},${s.b},${s.a})`;
  }
  const tClamped = Math.max(0, Math.min(1, t));
  const f = tClamped * (stops.length - 1);
  const j = Math.floor(f);
  const u = f - j;
  if (j >= stops.length - 1) {
    const s = stops[stops.length - 1]!;
    return `rgba(${s.r},${s.g},${s.b},${s.a})`;
  }
  const a = stops[j]!;
  const b = stops[j + 1]!;
  const r = Math.round(a.r + (b.r - a.r) * u);
  const g = Math.round(a.g + (b.g - a.g) * u);
  const bl = Math.round(a.b + (b.b - a.b) * u);
  const al = a.a + (b.a - a.a) * u;
  return `rgba(${r},${g},${bl},${al})`;
}
