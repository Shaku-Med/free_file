import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { detectWindapp, getWindappPlatform, useWindapp } from "~/lib/hooks/useWindapp";

const DISMISS_KEY = "memories_desktop_update_dismissed";
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

export type DesktopUpdateState = {
  ready: boolean;
  updateAvailable: boolean;
  current: string | null;
  latest: string | null;
  downloadPath: string | null;
  notes: string | null;
  dismissed: boolean;
  installing: boolean;
  dismiss: () => void;
  startUpdate: () => Promise<void>;
};

const DesktopUpdateContext = createContext<DesktopUpdateState | null>(null);

function readDismissedVersion(): string | null {
  try {
    return sessionStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

export function DesktopUpdateProvider({ children }: { children: ReactNode }) {
  const isWindapp = useWindapp();
  const [current, setCurrent] = useState<string | null>(null);
  const [latest, setLatest] = useState<string | null>(null);
  const [downloadPath, setDownloadPath] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!detectWindapp()) {
      setReady(true);
      return;
    }

    let version = "0.0.0";
    try {
      const v = await window.memoriesWindapp?.getVersion?.();
      if (typeof v === "string" && v.trim()) {
        version = v.trim();
        setCurrent(version);
      }
    } catch {
      /* ignore */
    }

    const platform = getWindappPlatform() || "win32";
    try {
      const res = await fetch(
        `/api/desktop/version?platform=${encodeURIComponent(platform)}&current=${encodeURIComponent(version)}`,
        {
          headers: {
            Accept: "application/json",
            "X-Memories-Desktop": "1",
          },
          credentials: "same-origin",
        },
      );
      if (!res.ok) {
        setReady(true);
        return;
      }
      const json = (await res.json()) as {
        success?: boolean;
        updateAvailable?: boolean;
        latest?: { version?: string; downloadPath?: string; notes?: string | null } | null;
      };
      if (!json?.success) {
        setReady(true);
        return;
      }
      const nextLatest = json.latest?.version ?? null;
      const available = !!json.updateAvailable && !!nextLatest;
      setUpdateAvailable(available);
      setLatest(nextLatest);
      setDownloadPath(json.latest?.downloadPath ?? null);
      setNotes(json.latest?.notes ?? null);
      const dismissedFor = readDismissedVersion();
      setDismissed(available && !!nextLatest && dismissedFor === nextLatest);
    } catch {
      /* ignore network errors */
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!isWindapp) {
      setReady(true);
      return;
    }
    void refresh();
    const id = window.setInterval(() => void refresh(), CHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [isWindapp, refresh]);

  const dismiss = useCallback(() => {
    if (latest) {
      try {
        sessionStorage.setItem(DISMISS_KEY, latest);
      } catch {
        /* ignore */
      }
    }
    setDismissed(true);
  }, [latest]);

  const startUpdate = useCallback(async () => {
    if (installing) return;
    setInstalling(true);
    try {
      if (typeof window.memoriesWindapp?.installUpdate === "function") {
        await window.memoriesWindapp.installUpdate();
        return;
      }
      if (downloadPath) {
        window.location.assign(downloadPath);
      }
    } finally {
      // If install quits the app this never runs; otherwise unlock the button.
      setInstalling(false);
    }
  }, [downloadPath, installing]);

  const value = useMemo<DesktopUpdateState>(
    () => ({
      ready,
      updateAvailable,
      current,
      latest,
      downloadPath,
      notes,
      dismissed,
      installing,
      dismiss,
      startUpdate,
    }),
    [
      ready,
      updateAvailable,
      current,
      latest,
      downloadPath,
      notes,
      dismissed,
      installing,
      dismiss,
      startUpdate,
    ],
  );

  return (
    <DesktopUpdateContext.Provider value={value}>{children}</DesktopUpdateContext.Provider>
  );
}

const EMPTY: DesktopUpdateState = {
  ready: true,
  updateAvailable: false,
  current: null,
  latest: null,
  downloadPath: null,
  notes: null,
  dismissed: false,
  installing: false,
  dismiss: () => {},
  startUpdate: async () => {},
};

export function useDesktopUpdate(): DesktopUpdateState {
  return useContext(DesktopUpdateContext) ?? EMPTY;
}

/** True when we should show sticky upgrade CTAs. */
export function useShowDesktopUpdateCta(): boolean {
  const isWindapp = useWindapp();
  const { ready, updateAvailable, dismissed } = useDesktopUpdate();
  return isWindapp && ready && updateAvailable && !dismissed;
}
