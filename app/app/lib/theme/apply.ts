import type { UserTheme } from "./constants";

export const STYLE_IMPORTS: Record<string, () => Promise<unknown>> = {
  default: () => import("~/lib/styles/default.css"),
  slate: () => import("~/lib/styles/slate.css"),
  zinc: () => import("~/lib/styles/zinc.css"),
  gray: () => import("~/lib/styles/gray.css"),
  stone: () => import("~/lib/styles/stone.css"),
  natural: () => import("~/lib/styles/natural.css"),
  rose: () => import("~/lib/styles/rose.css"),
  violet: () => import("~/lib/styles/violet.css"),
  amber: () => import("~/lib/styles/amber.css"),
  sky: () => import("~/lib/styles/sky.css"),
  emerald: () => import("~/lib/styles/emerald.css"),
  indigo: () => import("~/lib/styles/indigo.css"),
  teal: () => import("~/lib/styles/teal.css"),
  coral: () => import("~/lib/styles/coral.css"),
  youtube: () => import("~/lib/styles/youtube.css"),
};

export function applyTheme(userTheme: UserTheme | null | undefined) {
  const mode = userTheme?.theme ?? "system";
  const style = userTheme?.style ?? "default";
  document.documentElement.classList.remove("system", "light", "dark");
  document.documentElement.classList.add(mode);
  const load = STYLE_IMPORTS[style];
  if (load) load().catch(() => {});
}
