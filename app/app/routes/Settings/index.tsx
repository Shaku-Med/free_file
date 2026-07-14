import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { BellRing, CircleHelp, Fingerprint, Monitor, Moon, Sun, Trash2, ArrowUpCircle } from "lucide-react";
import { usePushNotifications } from "~/lib/hooks/usePushNotifications";
import { useStandalone } from "~/lib/hooks/useStandalone";
import { useWindapp } from "~/lib/hooks/useWindapp";
import { useDesktopUpdate } from "~/lib/hooks/useDesktopUpdate";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
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
import { cn } from "~/lib/utils";

function SettingsSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card/40 p-4 sm:p-5", className)}>
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {description ? (
        <p className="mt-0.5 mb-3 text-xs text-muted-foreground">{description}</p>
      ) : (
        <div className="mb-3" />
      )}
      {children}
    </section>
  );
}

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
  const isWindapp = useWindapp();
  const desktopUpdate = useDesktopUpdate();
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
  const [deleteInfoOpen, setDeleteInfoOpen] = useState(false);

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
      <div className="mx-auto w-full max-w-3xl px-3 py-5 sm:px-5 sm:py-6">
        <header className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Account, appearance, and preferences.
          </p>
        </header>

        <div className="space-y-4">
          {isWindapp ? (
            <SettingsSection
              title="Desktop app"
              description="Version of the Memories app installed on this computer."
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1 text-sm">
                  <div className="flex items-baseline gap-2">
                    <span className="text-muted-foreground">Current version</span>
                    <span className="font-medium tabular-nums text-foreground">
                      {desktopUpdate.current || (desktopUpdate.ready ? "—" : "…")}
                    </span>
                  </div>
                  {desktopUpdate.updateAvailable && desktopUpdate.latest ? (
                    <p className="text-xs text-muted-foreground">
                      Update available:{" "}
                      <span className="font-medium text-foreground">{desktopUpdate.latest}</span>
                    </p>
                  ) : desktopUpdate.ready && desktopUpdate.current ? (
                    <p className="text-xs text-muted-foreground">You’re up to date.</p>
                  ) : null}
                </div>
                {desktopUpdate.updateAvailable ? (
                  <Button
                    type="button"
                    size="sm"
                    className="shrink-0 gap-1.5"
                    disabled={desktopUpdate.installing}
                    onClick={() => void desktopUpdate.startUpdate()}
                  >
                    <ArrowUpCircle className="h-4 w-4" aria-hidden />
                    {desktopUpdate.installing ? "Updating…" : "Upgrade now"}
                  </Button>
                ) : null}
              </div>
            </SettingsSection>
          ) : null}

          <SettingsSection title="Theme" description="Light, dark, or match your device.">
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
          </SettingsSection>

          <SettingsSection title="Style" description="Color palette for the app.">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
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
                    <span className="truncate font-medium text-foreground">{label}</span>
                  </button>
                );
              })}
            </div>
          </SettingsSection>

          <SettingsSection
            title="Passkeys"
            description="Sign in without a password using Face ID, Touch ID, Windows Hello, or a security key."
          >
            <div className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground">
              <Fingerprint className="h-4 w-4" aria-hidden />
              Devices
            </div>
            {passkeysError && (
              <p className="mb-2 text-sm text-destructive" role="alert">
                {passkeysError}
              </p>
            )}
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end">
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
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background/60 px-3 py-2"
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
          </SettingsSection>

          {!isWindapp ? (
          <SettingsSection title="Notifications">
            {push.supported ? (
              <div className="flex items-start justify-between gap-4 py-1">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">Push notifications</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
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
                <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">Push notifications</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {needsInstall
                      ? "On iPhone & iPad, tap Share → Add to Home Screen, then open Memories from the Home Screen to turn notifications on."
                      : "This browser doesn't support push notifications. Try Chrome or Edge, or install the app to your Home Screen."}
                  </p>
                </div>
              </div>
            )}
          </SettingsSection>
          ) : null}

          <SettingsSection title="Storage">
            <StorageQuotaMeter variant="card" />
          </SettingsSection>

          <SettingsSection title="Content" description="What shows up in your feed.">
            <div className="flex items-center justify-between gap-4 py-1">
              <div>
                <p className="text-sm font-medium text-foreground">Show NSFW content</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
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
          </SettingsSection>

          <SettingsSection title="Privacy">
            <div className="flex items-center justify-between gap-4 py-1">
              <div>
                <p className="text-sm font-medium text-foreground">Pause watch history</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
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

            <div className="mt-3 flex items-center justify-between gap-4 border-t border-border/60 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">Clear watch history</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Removes your history and playback positions. This cannot be undone.
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
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            )}
            {clearNotice && (
              <p className="mt-2 text-xs text-muted-foreground" role="status">
                {clearNotice}
              </p>
            )}
          </SettingsSection>

          <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:p-5">
            <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
            <p className="mt-0.5 mb-4 text-xs text-muted-foreground">
              Serious account actions. Take a breath before you tap anything here.
            </p>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">Delete my account</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Permanently close your Memories account when you are ready.
                </p>
                <button
                  type="button"
                  onClick={() => setDeleteInfoOpen(true)}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                >
                  <CircleHelp className="h-3.5 w-3.5" aria-hidden />
                  What happens if I delete my account?
                </button>
              </div>
              <Button
                type="button"
                variant="destructive"
                disabled
                className="shrink-0 gap-1.5"
                title="Coming soon"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Coming soon
              </Button>
            </div>
          </section>

          <Dialog open={deleteInfoOpen} onOpenChange={setDeleteInfoOpen}>
            <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
              <DialogHeader>
                <DialogTitle>What happens if I delete my account?</DialogTitle>
                <DialogDescription className="sr-only">
                  How account deletion will work when this feature ships.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 text-sm leading-relaxed text-foreground">
                <p>
                  If you decide to delete your account, the wait can take a few days
                  depending on where you live. During that time your account and all
                  of your data are put on hold. You will not be able to use Memories
                  the normal way anywhere.
                </p>
                <p>
                  You can still sign in while deletion is scheduled. Before anything
                  is wiped for good, we ask whether you want an{" "}
                  <span className="font-medium">I changed my mind</span> button when
                  you come back. If you say yes, that cancel option stays with you.
                  If you say no, signing in later only shows the countdown and a way
                  to download a summary of your data.
                </p>
                <p>
                  While your account is waiting to be removed, almost nothing loads.
                  Your account is blocked from the rest of the app. You will mainly
                  see the timer, the cancel button if you chose to keep it, and{" "}
                  <span className="font-medium">Download my data</span>.
                </p>
                <p>
                  That download is a summary only. It covers things like your profile
                  name, comments, how many likes your uploads received, and your
                  interaction history. The actual files you uploaded are not included
                  in that export.
                </p>
                <p>
                  You can also ask for immediate deletion. That purges everything we
                  hold about you as soon as we can. It may wait in a short queue if
                  many people request the same thing at once. When it runs, your
                  files and everything else go right away.
                </p>
                <p className="text-muted-foreground">
                  Thanks for reading. This is just so you know. The delete button is
                  not live yet.
                </p>
              </div>

              <DialogFooter>
                <Button type="button" onClick={() => setDeleteInfoOpen(false)}>
                  Got it
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

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

          <div className="sticky bottom-0 z-10 -mx-3 border-t border-border/60 bg-background/95 px-3 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-5 sm:px-5">
            <div className="flex justify-end">
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
    </div>
  );
};

export default SettingsPage;
