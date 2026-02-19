import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { useFileContext } from "~/lib/Context/Context";
import {
  DEFAULT_THEME,
  THEME_MODES,
  THEME_STYLES,
  type ThemeMode,
  type ThemeStyle,
  type UserTheme,
} from "~/lib/theme/constants";
import { applyTheme } from "~/lib/theme/apply";

const STYLE_COLORS: Record<ThemeStyle, string> = {
  default: "#00a85c",
  slate: "#475569",
  zinc: "#71717a",
  gray: "#525252",
  stone: "#78716c",
  natural: "#737373",
  rose: "#e11d48",
  violet: "#7c3aed",
  amber: "#d97706",
  sky: "#0ea5e9",
  emerald: "#059669",
  indigo: "#4f46e5",
  teal: "#0d9488",
  coral: "#f97316",
};

const THEME_MODE_LABELS: Record<ThemeMode, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const SettingsPage = () => {
  const { userId } = useFileContext();
  const navigate = useNavigate();
  const [showNsfw, setShowNsfw] = useState(false);
  const [theme, setTheme] = useState<UserTheme>(DEFAULT_THEME);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (!userId) {
      navigate("/auth/login");
      return;
    }

    const loadSettings = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/settings");
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || "Failed to load settings");
        }
        const payload = await response.json();
        setShowNsfw(Boolean(payload?.showNsfw));
        if (payload?.theme && typeof payload.theme.theme === "string" && typeof payload.theme.style === "string") {
          setTheme({ theme: payload.theme.theme, style: payload.theme.style });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load settings");
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, [userId, navigate]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSaveSuccess(false);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showNsfw, theme }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Failed to update settings");
      }
      applyTheme(theme);
      setSaveSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update settings");
    } finally {
      setIsSaving(false);
    }
  };

  if (!userId) return null;

  return (
    <div className="min-h-screen w-full">
      <div className="w-full px-3 py-4 sm:px-4">
        <header className="mb-5">
          <h1 className="text-lg font-semibold text-foreground tracking-tight">Settings</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manage your account and preferences.
          </p>
        </header>

        <div className="space-y-6">
          <section>
            <h2 className="text-sm font-medium text-foreground mb-2">Theme</h2>
            <p className="text-xs text-muted-foreground mb-3">Light, dark, or follow system.</p>
            <div className="flex flex-wrap gap-2">
              {THEME_MODES.map((m) => {
                const selected = theme.theme === m;
                const Icon = m === "system" ? Monitor : m === "light" ? Sun : Moon;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setTheme((t) => ({ ...t, theme: m }))}
                    disabled={isLoading}
                    aria-pressed={selected}
                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 ${
                      selected
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {THEME_MODE_LABELS[m]}
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-medium text-foreground mb-2">Style</h2>
            <p className="text-xs text-muted-foreground mb-3">Color palette for the app.</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {THEME_STYLES.map((s) => {
                const selected = theme.style === s;
                const color = STYLE_COLORS[s];
                const label = s.charAt(0).toUpperCase() + s.slice(1);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setTheme((t) => ({ ...t, style: s }))}
                    disabled={isLoading}
                    aria-pressed={selected}
                    className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 ${
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-border bg-background hover:bg-muted"
                    }`}
                  >
                    <span
                      className="h-8 w-8 shrink-0 rounded-full border border-black/10 shadow-sm"
                      style={{ backgroundColor: color }}
                      aria-hidden
                    />
                    <span className="font-medium text-foreground truncate">{label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <Separator />

          <section>
            <h2 className="text-sm font-medium text-foreground mb-2">Content</h2>
            <div className="flex items-center justify-between gap-4 py-1">
              <div>
                <p className="text-sm font-medium text-foreground">Show NSFW content</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Include adult content in your feed.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showNsfw}
                onClick={() => setShowNsfw((prev) => !prev)}
                disabled={isLoading || isSaving}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-input transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                  showNsfw ? "bg-primary border-primary" : "bg-muted"
                }`}
              >
                <span
                  className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow ring-0 transition-transform ${
                    showNsfw ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          </section>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {saveSuccess && (
            <p className="text-sm text-muted-foreground" role="status">
              Settings saved.
            </p>
          )}

          <div className="flex justify-end pt-1">
            <Button
              onClick={handleSave}
              disabled={isLoading || isSaving}
              className="min-w-[120px]"
            >
              {isSaving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
