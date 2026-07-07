import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { BellRing, Fingerprint, Monitor, Moon, Sun } from "lucide-react";
import { usePushNotifications } from "~/lib/hooks/usePushNotifications";
import { useStandalone } from "~/lib/hooks/useStandalone";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
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
import { PasskeyUserMessage, friendlyPasskeyClientError } from "~/lib/webauthn/userMessages";
import { StorageQuotaMeter } from "~/components/StorageQuotaMeter";

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
  youtube: "#ff0000",
};

const THEME_MODE_LABELS: Record<ThemeMode, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/** iOS only allows Web Push from an installed PWA, so we detect it to guide the user. */
function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iPadOS = /Macintosh/i.test(ua) && typeof document !== "undefined" && "ontouchend" in document;
  return /iphone|ipad|ipod/i.test(ua) || iPadOS;
}

const SettingsPage = () => {
  const { userId } = useFileContext();
  const navigate = useNavigate();
  const push = usePushNotifications();
  const isStandalone = useStandalone();
  const [isIos, setIsIos] = useState(false);
  useEffect(() => setIsIos(isIosDevice()), []);
  // iPhone/iPad: push only works once added to the Home Screen.
  const needsInstall = !push.supported && isIos && !isStandalone;
  const [showNsfw, setShowNsfw] = useState(false);
  const [historyPaused, setHistoryPaused] = useState(false);
  const [clearArmed, setClearArmed] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearNotice, setClearNotice] = useState<string | null>(null);
  const [theme, setTheme] = useState<UserTheme>(DEFAULT_THEME);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [passkeys, setPasskeys] = useState<
    { id: string; device_name: string | null; created_at: string }[]
  >([]);
  const [passkeysLoading, setPasskeysLoading] = useState(false);
  const [passkeysError, setPasskeysError] = useState<string | null>(null);
  const [passkeyLabel, setPasskeyLabel] = useState("");
  const [passkeyBusy, setPasskeyBusy] = useState(false);

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
        setHistoryPaused(Boolean(payload?.historyPaused));
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

  const loadPasskeys = async () => {
    setPasskeysLoading(true);
    setPasskeysError(null);
    try {
      const res = await fetch("/api/webauthn/credentials", { credentials: "include" });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to load passkeys");
      }
      setPasskeys(Array.isArray(payload?.passkeys) ? payload.passkeys : []);
    } catch (err) {
      setPasskeysError(err instanceof Error ? err.message : "Failed to load passkeys");
    } finally {
      setPasskeysLoading(false);
    }
  };

  useEffect(() => {
    if (!userId) return;
    void loadPasskeys();
  }, [userId]);

  const handleAddPasskey = async () => {
    setPasskeyBusy(true);
    setPasskeysError(null);
    try {
      const { startRegistration } = await import("@simplewebauthn/browser");
      const optRes = await fetch("/api/webauthn/register-options", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const optPayload = await optRes.json().catch(() => null);
      if (!optRes.ok) {
        setPasskeysError(
          typeof optPayload?.error === "string" ? optPayload.error : PasskeyUserMessage.addPasskeyFailed
        );
        return;
      }
      const { flowId, options } = optPayload;
      if (!flowId || !options) {
        setPasskeysError(PasskeyUserMessage.addPasskeyFailed);
        return;
      }
      const reg = await startRegistration({ optionsJSON: options });
      const verifyRes = await fetch("/api/webauthn/register-verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flowId,
          response: reg,
          deviceName: passkeyLabel.trim() || undefined,
        }),
      });
      const verifyPayload = await verifyRes.json().catch(() => null);
      if (!verifyRes.ok) {
        setPasskeysError(
          typeof verifyPayload?.error === "string" ? verifyPayload.error : PasskeyUserMessage.addPasskeyFailed
        );
        return;
      }
      setPasskeyLabel("");
      await loadPasskeys();
    } catch (err) {
      setPasskeysError(friendlyPasskeyClientError(err, "register"));
    } finally {
      setPasskeyBusy(false);
    }
  };

  const handleRemovePasskey = async (id: string) => {
    setPasskeyBusy(true);
    setPasskeysError(null);
    try {
      const res = await fetch("/api/webauthn/credentials", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setPasskeysError(
          typeof payload?.error === "string" ? payload.error : PasskeyUserMessage.removePasskeyFailed
        );
        return;
      }
      await loadPasskeys();
    } catch {
      setPasskeysError(PasskeyUserMessage.removePasskeyFailed);
    } finally {
      setPasskeyBusy(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSaveSuccess(false);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showNsfw, historyPaused, theme }),
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

  const handleClearHistory = async () => {
    // First click arms, second click within the window actually clears.
    if (!clearArmed) {
      setClearArmed(true);
      setClearNotice(null);
      return;
    }
    setClearBusy(true);
    setClearNotice(null);
    try {
      const res = await fetch("/api/views/watch-history", {
        method: "DELETE",
        credentials: "include",
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.cleared) {
        throw new Error(payload?.error || "Failed to clear history");
      }
      setClearNotice("Watch history cleared.");
    } catch (err) {
      setClearNotice(err instanceof Error ? err.message : "Failed to clear history");
    } finally {
      setClearBusy(false);
      setClearArmed(false);
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
                const label = s === "youtube" ? "YouTube" : s.charAt(0).toUpperCase() + s.slice(1);
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
            <h2 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
              <Fingerprint className="h-4 w-4" aria-hidden />
              Passkeys
            </h2>
            <p className="text-xs text-muted-foreground mb-3">
              Sign in without a password using Face ID, Touch ID, Windows Hello, or a security key.
            </p>
            {passkeysError && (
              <p className="text-sm text-destructive mb-2" role="alert">
                {passkeysError}
              </p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end mb-3">
              <div className="flex-1 space-y-1">
                <label htmlFor="passkey-label" className="text-xs text-muted-foreground">
                  Label (optional)
                </label>
                <Input
                  id="passkey-label"
                  value={passkeyLabel}
                  onChange={(e) => setPasskeyLabel(e.target.value)}
                  placeholder="e.g. MacBook, YubiKey"
                  disabled={passkeyBusy || passkeysLoading}
                  maxLength={120}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void handleAddPasskey()}
                disabled={passkeyBusy || passkeysLoading || isLoading}
              >
                {passkeyBusy ? "Follow device prompt…" : "Add passkey"}
              </Button>
            </div>
            {passkeysLoading ? (
              <p className="text-sm text-muted-foreground">Loading passkeys…</p>
            ) : passkeys.length === 0 ? (
              <p className="text-sm text-muted-foreground">No passkeys yet.</p>
            ) : (
              <ul className="space-y-2">
                {passkeys.map((pk) => (
                  <li
                    key={pk.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {pk.device_name?.trim() || "Passkey"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Added {new Date(pk.created_at).toLocaleString()}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={passkeyBusy}
                      onClick={() => void handleRemovePasskey(pk.id)}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Separator />

          <section>
            <h2 className="text-sm font-medium text-foreground mb-2">Notifications</h2>
            {push.supported ? (
              <div className="flex items-start justify-between gap-4 py-1">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <BellRing className="h-5 w-5 shrink-0 text-primary mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">Push notifications</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {push.permission === "denied"
                        ? "Blocked in your browser settings. Allow notifications for this site to enable."
                        : push.isSubscribed
                          ? "You'll get alerts for new activity when you're not on the site."
                          : "Get notified when you're not on the site  works on this device."}
                    </p>
                    {push.error && (
                      <p className="mt-2 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                        {push.error}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={push.isSubscribed}
                  aria-label={push.isSubscribed ? "Disable push notifications" : "Enable push notifications"}
                  onClick={() => (push.isSubscribed ? push.unsubscribe() : push.subscribe())}
                  disabled={push.loading || push.permission === "denied"}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-input transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                    push.isSubscribed ? "bg-primary border-primary" : "bg-muted"
                  }`}
                >
                  <span
                    className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow ring-0 transition-transform ${
                      push.isSubscribed ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            ) : (
              <div className="flex items-start gap-3 py-1">
                <BellRing className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">Push notifications</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {needsInstall
                      ? "On iPhone & iPad, tap Share → Add to Home Screen, then open Memories from the Home Screen to turn notifications on."
                      : "This browser doesn't support push notifications. Try Chrome or Edge, or install the app to your Home Screen."}
                  </p>
                </div>
              </div>
            )}
          </section>

          <Separator />

          <section>
            <StorageQuotaMeter variant="card" />
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
                aria-label={showNsfw ? "Hide NSFW content" : "Show NSFW content"}
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

          <Separator />

          <section>
            <h2 className="text-sm font-medium text-foreground mb-2">Privacy</h2>
            <div className="flex items-center justify-between gap-4 py-1">
              <div>
                <p className="text-sm font-medium text-foreground">Pause watch history</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Stop saving what you watch. Recommendations get less personal.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={historyPaused}
                aria-label={historyPaused ? "Resume watch history" : "Pause watch history"}
                onClick={() => setHistoryPaused((prev) => !prev)}
                disabled={isLoading || isSaving}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-input transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                  historyPaused ? "bg-primary border-primary" : "bg-muted"
                }`}
              >
                <span
                  className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow ring-0 transition-transform ${
                    historyPaused ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>

            <div className="mt-3 flex items-center justify-between gap-4 py-1">
              <div>
                <p className="text-sm font-medium text-foreground">Clear watch history</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Removes your history and playback positions. This can't be undone.
                </p>
              </div>
              <Button
                type="button"
                variant={clearArmed ? "destructive" : "outline"}
                onClick={handleClearHistory}
                disabled={clearBusy}
                className="shrink-0"
              >
                {clearBusy ? "Clearing…" : clearArmed ? "Tap to confirm" : "Clear"}
              </Button>
            </div>
            {clearArmed && !clearBusy && (
              <button
                type="button"
                onClick={() => setClearArmed(false)}
                className="mt-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            )}
            {clearNotice && (
              <p className="mt-2 text-xs text-muted-foreground" role="status">
                {clearNotice}
              </p>
            )}
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
