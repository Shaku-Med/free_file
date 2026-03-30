import { useEffect, useId, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "~/lib/utils";

type ThemeModeClass = "system" | "light" | "dark";

function readThemeModeFromDocument(): ThemeModeClass {
  if (typeof document === "undefined") return "system";
  const pick = (el: Element | null): ThemeModeClass | null => {
    if (!el) return null;
    if (el.classList.contains("dark")) return "dark";
    if (el.classList.contains("light")) return "light";
    if (el.classList.contains("system")) return "system";
    return null;
  };
  return pick(document.documentElement) ?? pick(document.body) ?? "system";
}

function effectiveAppearanceIsDark(mode: ThemeModeClass): boolean {
  if (typeof window === "undefined") return false;
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Parse any CSS color the browser understands (incl. oklch from theme) to RGBA. */
function cssColorToRgba(css: string): { r: number; g: number; b: number; a: number } | null {
  if (typeof document === "undefined" || !css.trim()) return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.fillStyle = "#000000";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  } catch {
    return null;
  }
}

function channelToLinear(c: number): number {
  const x = c / 255;
  return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance (0–1). */
function relativeLuminance(r: number, g: number, b: number): number {
  const R = channelToLinear(r);
  const G = channelToLinear(g);
  const B = channelToLinear(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function luminanceFromCssColor(css: string): number | null {
  const p = cssColorToRgba(css);
  if (!p) return null;
  return relativeLuminance(p.r, p.g, p.b);
}

/**
 * Darken or soften blob vs `var(--foreground)` so titles stay readable.
 * Dark UI: pull bright blobs away from light text (darken RGB).
 * Light UI: if blob luminance is too close to dark text, lower alpha only.
 */
function tuneBlobAgainstForeground(
  cssColor: string,
  foregroundL: number,
  effectiveDark: boolean
): string {
  const parsed = cssColorToRgba(cssColor);
  if (!parsed) return cssColor;
  let { r, g, b, a } = parsed;
  const blobL = relativeLuminance(r, g, b);
  const lumDiff = Math.abs(blobL - foregroundL);

  if (effectiveDark) {
    const tooBrightVersusText = blobL > foregroundL - 0.22;
    const tooCloseToText = lumDiff < 0.16;
    if (tooBrightVersusText || tooCloseToText) {
      const factor = 0.44;
      r = Math.round(r * factor);
      g = Math.round(g * factor);
      b = Math.round(b * factor);
      a = Math.min(1, a * 0.9);
    }
  } else {
    if (blobL < 0.48 && lumDiff < 0.14) {
      a = Math.min(1, a * 0.58);
    }
  }

  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function expandPalette(raw: string[] | null | undefined): [string, string, string, string] {
  const list = (raw ?? []).filter((c): c is string => typeof c === "string" && c.trim() !== "");
  if (list.length === 0) {
    return [
      "color-mix(in oklch, var(--primary) 50%, transparent)",
      "color-mix(in oklch, var(--chart-2) 42%, transparent)",
      "color-mix(in oklch, var(--chart-3) 38%, transparent)",
      "color-mix(in oklch, var(--chart-4) 32%, transparent)",
    ];
  }
  const pick = (i: number) => list[i % list.length];
  return [pick(0), pick(1), pick(2), pick(3)];
}

type LiquidAmbientGradientProps = {
  colors?: string[] | null;
  className?: string;
};

/** SVG film grain + faint weave; sits above blobs for a tactile, print-like finish. */
function AmbientTextureLayers({
  grainFilterId,
  effectiveDark,
}: {
  grainFilterId: string;
  effectiveDark: boolean;
}) {
  return (
    <>
      <div
        className={cn(
          "absolute inset-0 pointer-events-none",
          effectiveDark ? "opacity-[0.125] mix-blend-overlay" : "opacity-[0.085] mix-blend-soft-light"
        )}
      >
        <svg className="h-full w-full" preserveAspectRatio="none" aria-hidden>
          <defs>
            <filter
              id={grainFilterId}
              x="-25%"
              y="-25%"
              width="150%"
              height="150%"
              colorInterpolationFilters="sRGB"
            >
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.72"
                numOctaves="4"
                stitchTiles="stitch"
                result="coarse"
              />
              <feTurbulence
                type="fractalNoise"
                baseFrequency="1.85"
                numOctaves="2"
                stitchTiles="stitch"
                result="fine"
              />
              <feBlend in="coarse" in2="fine" mode="soft-light" result="merged" />
              <feColorMatrix
                in="merged"
                type="matrix"
                values="0.33 0.33 0.33 0 0
                        0.33 0.33 0.33 0 0
                        0.33 0.33 0.33 0 0
                        0 0 0 1 0"
                result="mono"
              />
              <feComponentTransfer in="mono" result="grain">
                <feFuncA type="linear" slope="0.45" intercept="0.08" />
              </feComponentTransfer>
            </filter>
          </defs>
          <rect width="100%" height="100%" filter={`url(#${grainFilterId})`} fill="#ffffff" />
        </svg>
      </div>

      <div
        className={cn(
          "absolute inset-0 pointer-events-none",
          effectiveDark ? "opacity-[0.055] mix-blend-soft-light" : "opacity-[0.035] mix-blend-multiply"
        )}
        style={{
          backgroundImage: effectiveDark
            ? `repeating-linear-gradient(
                118deg,
                rgba(255,255,255,0.14) 0px,
                transparent 0.5px,
                transparent 5px,
                rgba(255,255,255,0.06) 5.5px,
                transparent 6px
              ),
              repeating-linear-gradient(
                -32deg,
                transparent 0px,
                transparent 4px,
                rgba(255,255,255,0.05) 4px,
                rgba(255,255,255,0.05) 4.5px,
                transparent 5px
              )`
            : `repeating-linear-gradient(
                118deg,
                rgba(0,0,0,0.04) 0px,
                transparent 0.5px,
                transparent 5px,
                rgba(0,0,0,0.025) 5.5px,
                transparent 6px
              ),
              repeating-linear-gradient(
                -32deg,
                transparent 0px,
                transparent 4px,
                rgba(0,0,0,0.03) 4px,
                rgba(0,0,0,0.03) 4.5px,
                transparent 5px
              )`,
        }}
      />

      <div
        className={cn(
          "absolute inset-0 pointer-events-none rounded-[inherit]",
          effectiveDark ? "opacity-[0.06] mix-blend-overlay" : "opacity-[0.04] mix-blend-multiply"
        )}
        style={{
          backgroundImage: effectiveDark
            ? `radial-gradient(circle at 20% 30%, rgba(255,255,255,0.22) 0.5px, transparent 0.65px),
               radial-gradient(circle at 72% 64%, rgba(255,255,255,0.14) 0.45px, transparent 0.6px)`
            : `radial-gradient(circle at 20% 30%, rgba(0,0,0,0.07) 0.5px, transparent 0.65px),
               radial-gradient(circle at 72% 64%, rgba(0,0,0,0.05) 0.45px, transparent 0.6px)`,
          backgroundSize: "5px 5px, 7px 7px",
          backgroundPosition: "0 0, 2px 3px",
        }}
      />
    </>
  );
}

/**
 * Soft, slow-moving mesh behind Dynamic metadata.
 * Adjusts palette against computed `--foreground` so blobs don’t compete with text;
 * respects theme class on `html` / `body` (`light` | `dark` | `system`) and system preference.
 */
export default function LiquidAmbientGradient({ colors, className }: LiquidAmbientGradientProps) {
  const reduceMotion = useReducedMotion();
  const grainFilterId = `lag-grain-${useId().replace(/:/g, "")}`;
  const [docGeneration, setDocGeneration] = useState(0);

  useEffect(() => {
    const bump = () => setDocGeneration((n) => n + 1);
    const html = document.documentElement;
    const obs = new MutationObserver(bump);
    obs.observe(html, { attributes: true, attributeFilter: ["class"] });
    const body = document.body;
    if (body) {
      obs.observe(body, { attributes: true, attributeFilter: ["class"] });
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", bump);
    return () => {
      obs.disconnect();
      mq.removeEventListener("change", bump);
    };
  }, []);

  const { c0, c1, c2, c3, themeMode, effectiveDark } = useMemo(() => {
    const base = expandPalette(colors);
    if (typeof document === "undefined") {
      return {
        c0: base[0],
        c1: base[1],
        c2: base[2],
        c3: base[3],
        themeMode: "system" as ThemeModeClass,
        effectiveDark: false,
      };
    }
    const mode = readThemeModeFromDocument();
    const effDark = effectiveAppearanceIsDark(mode);
    const fgRaw = getComputedStyle(document.documentElement).getPropertyValue("--foreground").trim();
    const fgL = luminanceFromCssColor(fgRaw) ?? (effDark ? 0.92 : 0.12);
    const [b0, b1, b2, b3] = base.map((c) => tuneBlobAgainstForeground(c, fgL, effDark));
    return { c0: b0, c1: b1, c2: b2, c3: b3, themeMode: mode, effectiveDark: effDark };
  }, [colors, docGeneration]);

  const drift = reduceMotion
    ? {}
    : {
        animate: {
          x: [0, 18, -8, 12, 0],
          y: [0, -14, 10, -6, 0],
          scale: [1, 1.08, 0.96, 1.04, 1],
        },
        transition: {
          duration: 24,
          repeat: Infinity,
          ease: "easeInOut" as const,
        },
      };

  const driftAlt = reduceMotion
    ? {}
    : {
        animate: {
          x: [0, -16, 14, -10, 0],
          y: [0, 12, -18, 8, 0],
          scale: [1, 0.94, 1.1, 0.98, 1],
        },
        transition: {
          duration: 28,
          repeat: Infinity,
          ease: "easeInOut" as const,
        },
      };

  const driftSlow = reduceMotion
    ? {}
    : {
        animate: {
          rotate: [0, 8, -6, 4, 0],
          scale: [1, 1.12, 1.05, 1.08, 1],
        },
        transition: {
          duration: 32,
          repeat: Infinity,
          ease: "easeInOut" as const,
        },
      };

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 -z-[1] overflow-hidden",
        className
      )}
      aria-hidden
      data-theme-mode={themeMode}
      data-theme-effective={effectiveDark ? "dark" : "light"}
    >
      <div
        className={cn(
          "absolute inset-[-25%] scale-[1.35]",
          "blur-sm sm:blur-md md:blur-lg",
          effectiveDark ? "opacity-[0.82]" : "opacity-[0.9]"
        )}
      >
        <motion.div
          className="absolute left-[-8%] top-[-18%] h-[72%] w-[72%] rounded-[48%]"
          style={{
            background: `radial-gradient(ellipse 80% 70% at 35% 40%, ${c0}, transparent 72%)`,
          }}
          {...drift}
        />
        <motion.div
          className="absolute right-[-12%] top-[5%] h-[68%] w-[68%] rounded-[46%]"
          style={{
            background: `radial-gradient(ellipse 75% 80% at 60% 45%, ${c1}, transparent 70%)`,
          }}
          {...driftAlt}
        />
        <motion.div
          className="absolute bottom-[-20%] left-[15%] h-[65%] w-[80%] rounded-[50%]"
          style={{
            background: `radial-gradient(ellipse 90% 65% at 50% 70%, ${c2}, transparent 68%)`,
          }}
          {...driftSlow}
        />
        <div
          className={cn(
            "absolute inset-[10%] rounded-[40%] opacity-70",
            effectiveDark ? "mix-blend-screen" : "mix-blend-soft-light"
          )}
          style={{
            background: `radial-gradient(ellipse 60% 50% at 50% 50%, ${c3}, transparent 75%)`,
          }}
        />
      </div>

      <div
        className={cn(
          "absolute inset-0",
          effectiveDark ? "opacity-25" : "opacity-40",
          "bg-gradient-to-b from-background/0 via-transparent to-background/60",
          effectiveDark && "to-background/70"
        )}
      />

      <div
        className={cn(
          "pointer-events-none absolute inset-0",
          effectiveDark ? "opacity-[0.2]" : "opacity-[0.35]",
          effectiveDark
            ? "bg-[radial-gradient(ellipse_100%_60%_at_50%_-10%,rgba(255,255,255,0.12),transparent_50%)]"
            : "bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(255,255,255,0.5),transparent_55%)]"
        )}
      />

      <AmbientTextureLayers grainFilterId={grainFilterId} effectiveDark={effectiveDark} />
    </div>
  );
}
