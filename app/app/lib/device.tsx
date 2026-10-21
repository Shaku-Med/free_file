import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Which system look the web takes on, so it matches the app on the same phone:
 * - `ios-glass`: iOS 26 and later, Liquid Glass.
 * - `ios`: older iOS.
 * - `material3`: Android 12 and later (or unknown), Material 3.
 * - `material2`: older Android, Material 2.
 * - `default`: everything else, including desktop browsers in a narrow window.
 */
export type DeviceStyle = "default" | "ios-glass" | "ios" | "material3" | "material2";

type UserAgentData = {
  getHighEntropyValues?: (hints: string[]) => Promise<{ platform?: string; platformVersion?: string }>;
};

function isIos(ua: string): boolean {
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return typeof navigator !== "undefined" && /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
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

/**
 * The look as far as the user agent alone tells, so the server's first paint
 * already matches the phone instead of flashing the desktop look first. The
 * browser then refines it (an iPad that says Mac, Android's real version).
 */
export function deviceStyleFromUserAgent(ua: string | null | undefined): DeviceStyle {
  if (!ua) return "default";
  if (isIos(ua)) return isLiquidGlassIos(ua) ? "ios-glass" : "ios";
  if (/Android/i.test(ua)) return androidStyle(reportedAndroidMajor(ua));
  return "default";
}

/** Chrome's reduced UA always says "Android 10; K", so treat that as unknown. */
function reportedAndroidMajor(ua: string): number | null {
  if (/Android 10; K\)/.test(ua)) return null;
  const match = /Android (\d+)/.exec(ua);
  return match ? Number(match[1]) : null;
}

function androidStyle(major: number | null): DeviceStyle {
  return major !== null && major < 12 ? "material2" : "material3";
}

const DeviceStyleContext = createContext<DeviceStyle>("default");

/**
 * Works the device out once for the whole page. It also lands on
 * `<html data-device>`, for the few styles that live in CSS.
 */
export function DeviceStyleProvider({ initial = "default", children }: { initial?: DeviceStyle; children: ReactNode }) {
  const [style, setStyle] = useState<DeviceStyle>(initial);

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

  useEffect(() => {
    const root = document.documentElement;
    if (style === "default") delete root.dataset.device;
    else root.dataset.device = style;
  }, [style]);

  return <DeviceStyleContext.Provider value={style}>{children}</DeviceStyleContext.Provider>;
}

export function useDeviceStyle(): DeviceStyle {
  return useContext(DeviceStyleContext);
}

/** The platform family, for looks that are the same across its versions. */
export function platformOf(style: DeviceStyle): "ios" | "material" | null {
  if (style === "ios" || style === "ios-glass") return "ios";
  if (style === "material3" || style === "material2") return "material";
  return null;
}
