import { useEffect, useState } from "react";

/**
 * Which system tab bar the mobile web bar imitates, so it matches the app:
 * - `ios-glass`: iOS 26 and later, the floating Liquid Glass capsule.
 * - `ios`: older iOS, the full-width translucent UITabBar.
 * - `material3`: Android 12 and later (or unknown), Material 3 navigation bar.
 * - `material2`: older Android, Material 2 bottom navigation.
 * - `default`: everything else, including desktop browsers in a narrow window.
 */
export type TabBarStyle = "default" | "ios-glass" | "ios" | "material3" | "material2";

type UserAgentData = {
  getHighEntropyValues?: (hints: string[]) => Promise<{ platform?: string; platformVersion?: string }>;
};

function isIos(ua: string): boolean {
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

/**
 * Safari 26 still reports iOS 18 in its OS token, so its `Version/` token is
 * the real signal. Other iOS browsers carry no `Version/`, but they all run
 * WebKit, and scroll-driven animations first shipped in WebKit 26.
 */
function isLiquidGlassIos(ua: string): boolean {
  const os = /OS (\d+)_\d+/.exec(ua);
  if (os && Number(os[1]) >= 26) return true;
  const safari = /Version\/(\d+)/.exec(ua);
  if (safari) return Number(safari[1]) >= 26;
  return typeof CSS !== "undefined" && CSS.supports("animation-timeline", "scroll()");
}

/** Chrome's reduced UA always says "Android 10; K", so treat that as unknown. */
function reportedAndroidMajor(ua: string): number | null {
  if (/Android 10; K\)/.test(ua)) return null;
  const match = /Android (\d+)/.exec(ua);
  return match ? Number(match[1]) : null;
}

function androidStyle(major: number | null): TabBarStyle {
  return major !== null && major < 12 ? "material2" : "material3";
}

export function useTabBarStyle(): TabBarStyle {
  const [style, setStyle] = useState<TabBarStyle>("default");

  useEffect(() => {
    const ua = navigator.userAgent;
    if (isIos(ua)) {
      setStyle(isLiquidGlassIos(ua) ? "ios-glass" : "ios");
      return;
    }
    if (!/Android/i.test(ua)) return;

    setStyle(androidStyle(reportedAndroidMajor(ua)));
    let cancelled = false;
    const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
    data
      ?.getHighEntropyValues?.(["platformVersion"])
      .then(({ platform, platformVersion }) => {
        const major = Number.parseInt(platformVersion ?? "", 10);
        if (!cancelled && platform === "Android" && Number.isFinite(major)) setStyle(androidStyle(major));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return style;
}
