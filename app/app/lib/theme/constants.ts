export const THEME_MODES = ["system", "light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const THEME_STYLES = [
  "default",
  "slate",
  "zinc",
  "gray",
  "stone",
  "natural",
  "rose",
  "violet",
  "amber",
  "sky",
  "emerald",
  "indigo",
  "teal",
  "coral",
  "youtube",
] as const;
export type ThemeStyle = (typeof THEME_STYLES)[number];

export interface UserTheme {
  theme: ThemeMode;
  style: ThemeStyle;
}

export const DEFAULT_THEME: UserTheme = {
  theme: "system",
  style: "default",
};

export function isValidThemeMode(v: unknown): v is ThemeMode {
  return typeof v === "string" && THEME_MODES.includes(v as ThemeMode);
}

export function isValidThemeStyle(v: unknown): v is ThemeStyle {
  return typeof v === "string" && THEME_STYLES.includes(v as ThemeStyle);
}

export function parseUserTheme(raw: unknown): UserTheme | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const theme = o.theme;
  const style = o.style;
  if (!isValidThemeMode(theme) || !isValidThemeStyle(style)) return null;
  return { theme, style };
}
