import { useMemo } from "react";
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

export default function LiquidAmbientGradient({ colors, className }: LiquidAmbientGradientProps) {
  const { c0, c1, c2, c3, effectiveDark } = useMemo(() => {
    const [b0, b1, b2, b3] = expandPalette(colors);
    if (typeof document === "undefined") {
      return { c0: b0, c1: b1, c2: b2, c3: b3, effectiveDark: false };
    }
    const mode = readThemeModeFromDocument();
    const effDark = effectiveAppearanceIsDark(mode);
    return { c0: b0, c1: b1, c2: b2, c3: b3, effectiveDark: effDark };
  }, [colors]);

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 -z-[1] overflow-hidden",
        className
      )}
      aria-hidden
    >
      <div
        className={cn(
          "absolute inset-[-15%]",
          "blur-xl",
          effectiveDark ? "opacity-[0.7]" : "opacity-[0.8]"
        )}
        style={{ willChange: "transform" }}
      >
        <div
          className="absolute left-[-8%] top-[-18%] h-[72%] w-[72%] rounded-[48%]"
          style={{
            background: `radial-gradient(ellipse 80% 70% at 35% 40%, ${c0}, transparent 72%)`,
          }}
        />
        <div
          className="absolute right-[-12%] top-[5%] h-[68%] w-[68%] rounded-[46%]"
          style={{
            background: `radial-gradient(ellipse 75% 80% at 60% 45%, ${c1}, transparent 70%)`,
          }}
        />
        <div
          className="absolute bottom-[-20%] left-[15%] h-[65%] w-[80%] rounded-[50%]"
          style={{
            background: `radial-gradient(ellipse 90% 65% at 50% 70%, ${c2}, transparent 68%)`,
          }}
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
    </div>
  );
}
