/**
 * Media Session / lock-screen artwork helpers.
 * OS surfaces often expect square artwork; non-square posters are letterboxed into 1:1 on a canvas.
 * Results are cached in-memory for the tab session so the same video does not re-render every time.
 */

const DEFAULT_SIZE = 512;
const SQUARE_RATIO_EPS = 0.02;
const MAX_CACHE_ENTRIES = 48;

const sessionCache = new Map<string, string>();

function revokeIfBlob(url: string) {
  if (url.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
}

function cacheGet(key: string): string | null {
  const v = sessionCache.get(key);
  if (v == null) return null;
  sessionCache.delete(key);
  sessionCache.set(key, v);
  return v;
}

function cacheSet(key: string, url: string) {
  const existing = sessionCache.get(key);
  if (existing && existing !== url) {
    revokeIfBlob(existing);
  }
  if (sessionCache.has(key)) {
    sessionCache.delete(key);
  }
  while (sessionCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = sessionCache.keys().next().value as string | undefined;
    if (oldest == null) break;
    const oldUrl = sessionCache.get(oldest);
    sessionCache.delete(oldest);
    if (oldUrl) revokeIfBlob(oldUrl);
  }
  sessionCache.set(key, url);
}

function isNearlySquare(w: number, h: number): boolean {
  if (!w || !h) return false;
  const r = w / h;
  return r >= 1 - SQUARE_RATIO_EPS && r <= 1 + SQUARE_RATIO_EPS;
}

function loadImageForCanvas(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("/")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = src;
  });
}

function isUsableCanvasFillColor(c: string): boolean {
  if (!c || c === "transparent") return false;
  const m = c.match(/^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/i);
  if (m) return parseFloat(m[1]) > 0;
  return true;
}

/**
 * Resolves `var(--background)` to a concrete color for canvas `fillStyle`
 * (matches Tailwind `bg-background` / shadcn-style HSL tokens).
 */
export function resolveThemeBackgroundForCanvas(): string {
  if (typeof document === "undefined") return "#0a0a0a";

  const probe = document.createElement("div");
  const read = (cssValue: string): string | null => {
    probe.style.cssText = `position:fixed;left:-99999px;top:0;width:1px;height:1px;visibility:hidden;pointer-events:none;background-color:${cssValue}`;
    document.documentElement.appendChild(probe);
    const c = getComputedStyle(probe).backgroundColor;
    probe.remove();
    if (!isUsableCanvasFillColor(c)) return null;
    return c;
  };

  for (const v of [
    "hsl(var(--background))",
    "hsl(var(--background) / 1)",
    "oklch(var(--background))",
    "var(--background)",
  ]) {
    const got = read(v);
    if (got) return got;
  }

  const raw = getComputedStyle(document.documentElement).getPropertyValue("--background").trim();
  if (raw) {
    if (raw.startsWith("#")) return raw;
    if (raw.startsWith("rgb") || raw.startsWith("hsl(") || raw.startsWith("oklch(")) return raw;
    const compact = raw.replace(/\s+/g, " ");
    const hslWrapped = read(`hsl(${compact})`);
    if (hslWrapped) return hslWrapped;
    const oklchWrapped = read(`oklch(${compact})`);
    if (oklchWrapped) return oklchWrapped;
  }

  return "#0a0a0a";
}

export type SquareArtworkOptions = {
  /** Output width/height (default 512). */
  size?: number;
  /** Letterbox fill (default: resolved `var(--background)`). */
  background?: string;
};

/**
 * Returns a URL suitable for `MediaMetadata.artwork`:
 * - Already ~square: returns `sourceUrl` unchanged (no canvas work).
 * - Otherwise: JPEG blob URL, image fitted inside a square preserving aspect ratio.
 *
 * @param cacheKey Stable key for session cache (e.g. `videoUniqueId + thumbnail path`).
 */
export async function getSquareMediaSessionArtwork(
  sourceUrl: string,
  cacheKey: string,
  options?: SquareArtworkOptions
): Promise<string | null> {
  if (typeof document === "undefined" || !sourceUrl) return sourceUrl || null;

  const letterbox = options?.background ?? resolveThemeBackgroundForCanvas();
  const effectiveCacheKey = `${cacheKey}\0${letterbox}`;
  const hit = cacheGet(effectiveCacheKey);
  if (hit) return hit;

  const size = options?.size ?? DEFAULT_SIZE;
  const background = letterbox;

  try {
    const img = await loadImageForCanvas(sourceUrl);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) {
      cacheSet(effectiveCacheKey, sourceUrl);
      return sourceUrl;
    }

    if (isNearlySquare(w, h)) {
      cacheSet(effectiveCacheKey, sourceUrl);
      return sourceUrl;
    }

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      cacheSet(cacheKey, sourceUrl);
      return sourceUrl;
    }

    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size, size);

    const scale = Math.min(size / w, size / h);
    const dw = w * scale;
    const dh = h * scale;
    const dx = (size - dw) / 2;
    const dy = (size - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);

    const blob: Blob | null = await new Promise((res) =>
      canvas.toBlob((b) => res(b), "image/jpeg", 0.92)
    );
    if (!blob) {
      cacheSet(effectiveCacheKey, sourceUrl);
      return sourceUrl;
    }

    const out = URL.createObjectURL(blob);
    cacheSet(effectiveCacheKey, out);
    return out;
  } catch {
    cacheSet(effectiveCacheKey, sourceUrl);
    return sourceUrl;
  }
}
