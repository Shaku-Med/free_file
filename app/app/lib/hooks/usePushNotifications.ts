import { useState, useCallback, useEffect } from "react";

/**
 * Web Push: browsers require a "secure context" for push.
 * Development: http://localhost is treated as secure, so push works on localhost without HTTPS.
 * Production: use HTTPS.
 */

/** Decode base64url VAPID key to Uint8Array for PushManager.subscribe */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) output[i] = rawData.charCodeAt(i);
  return output;
}

export type PushPermissionState = "default" | "granted" | "denied" | "unsupported";

export function usePushNotifications() {
  const [permission, setPermission] = useState<PushPermissionState>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkSupport = useCallback(() => {
    return (
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window
    );
  }, []);

  const updatePermissionState = useCallback(() => {
    if (!("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    const p = Notification.permission;
    setPermission(p === "granted" ? "granted" : p === "denied" ? "denied" : "default");
  }, []);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!checkSupport()) {
      setError("Push notifications are not supported in this browser.");
      setPermission("unsupported");
      return false;
    }
    const log = (msg: string, err?: unknown) => {
      if (err !== undefined) console.error("[Push]", msg, err);
      else console.log("[Push]", msg);
    };

    // Request permission as the FIRST thing in the click handler  before any
    // setState or other async work. React state updates / extra awaits ahead
    // of this can consume the browser's transient user-activation, which makes
    // strict browsers (notably Safari) silently suppress the OS prompt.
    let permissionResult: NotificationPermission;
    try {
      log("1. Requesting notification permission...");
      permissionResult = await Notification.requestPermission();
    } catch (e) {
      log("1. requestPermission threw:", e);
      setError("Something went wrong. Please try again.");
      return false;
    }
    setPermission(permissionResult === "granted" ? "granted" : permissionResult === "denied" ? "denied" : "default");
    if (permissionResult !== "granted") {
      setError(permissionResult === "denied" ? "Permission denied." : "Permission dismissed.");
      log("1. Permission not granted:", permissionResult);
      return false;
    }
    log("1. Permission granted");

    setLoading(true);
    setError(null);
    try {
      log("2. Waiting for service worker...");
      const reg = await navigator.serviceWorker.ready;
      if (!reg.active) {
        log("2. No active service worker, registering...");
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        await navigator.serviceWorker.ready;
      }
      log("2. Service worker active");

      log("3. Fetching VAPID public key...");
      const vapidRes = await fetch("/api/push-vapid-public");
      const vapidData = await vapidRes.json();
      if (!vapidRes.ok || !vapidData.publicKey) {
        log("3. VAPID fetch failed:", { status: vapidRes.status, data: vapidData });
        setError("Something went wrong. Please try again.");
        return false;
      }
      log("3. VAPID key received");

      log("4. Clearing stale push subscription...");
      const existingSub = await reg.pushManager.getSubscription();
      if (existingSub) {
        try { await existingSub.unsubscribe(); } catch { /* ignore */ }
        log("4. Stale subscription removed");
      } else {
        log("4. No stale subscription");
      }

      log("5. Subscribing to push manager...");
      const keyBytes = urlBase64ToUint8Array(vapidData.publicKey);
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes.buffer as ArrayBuffer,
      });
      log("5. Push subscription created");

      log("6. Sending subscription to server...");
      const subJson = subscription.toJSON();
      const res = await fetch("/api/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: { p256dh: subJson.keys?.p256dh, auth: subJson.keys?.auth },
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        log("6. Server rejected save:", { status: res.status, body: errBody });
        setError("Something went wrong. Please try again.");
        return false;
      }
      log("6. Server saved subscription, done.");
      setIsSubscribed(true);
      return true;
    } catch (e) {
      log("Failed at one of the steps above:", e);
      setError("Something went wrong. Please try again.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [checkSupport]);

  useEffect(() => {
    if (!checkSupport()) return;
    updatePermissionState();
    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((sub) => setIsSubscribed(!!sub))
    );
  }, [checkSupport, updatePermissionState]);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!checkSupport()) return false;
    setLoading(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        const res = await fetch("/api/push-subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        if (!res.ok) throw new Error("Failed to remove subscription");
      }
      setIsSubscribed(false);
      return true;
    } catch {
      setError("Something went wrong. Please try again.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [checkSupport]);

  return {
    permission,
    isSubscribed,
    loading,
    error,
    supported: checkSupport(),
    updatePermissionState,
    subscribe,
    unsubscribe,
  };
}
