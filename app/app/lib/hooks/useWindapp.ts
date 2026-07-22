import { useEffect, useState } from "react";

declare global {
  interface Window {
    __MEMORIES_WINDAPP__?: boolean;
    __MEMORIES_WINDAPP_PLATFORM__?: string;
    memoriesWindapp?: {
      isDesktop?: boolean;
      /** Electron `process.platform` — `darwin` | `win32` | `linux`. */
      platform?: string;
      getVersion?: () => Promise<string>;
      installUpdate?: () => Promise<unknown>;
      minimize?: () => void | Promise<void>;
      maximize?: () => void | Promise<boolean>;
      close?: () => void | Promise<void>;
      isMaximized?: () => Promise<boolean>;
      /** Native OS window fullscreen (desktop app uses this, not HTML5 fullscreen). */
      setFullScreen?: (on: boolean) => Promise<boolean>;
      isFullScreen?: () => Promise<boolean>;
      /** Fires with the live fullscreen state on enter/leave; returns an unsubscribe. */
      onFullscreenChange?: (callback: (on: boolean) => void) => () => void;
      goBack?: () => Promise<boolean>;
      goForward?: () => Promise<boolean>;
      reload?: () => Promise<void>;
      canGoBack?: () => Promise<boolean>;
      canGoForward?: () => Promise<boolean>;
      setMediaState?: (state: {
        playing: boolean;
        canNext?: boolean;
        canPrevious?: boolean;
        progress?: number;
        title?: string;
      }) => Promise<boolean>;
      clearMediaState?: () => Promise<boolean>;
      closePip?: () => Promise<unknown>;
      onMediaAction?: (
        callback: (action: "play" | "pause" | "nexttrack" | "previoustrack") => void,
      ) => () => void;
    };
  }
}

/** Electron platform when running inside windapp (`darwin` / `win32` / `linux`). */
export function getWindappPlatform(): string | null {
  if (typeof window === "undefined") return null;
  const fromApi = window.memoriesWindapp?.platform;
  if (fromApi) return fromApi;
  if (typeof window.__MEMORIES_WINDAPP_PLATFORM__ === "string") {
    return window.__MEMORIES_WINDAPP_PLATFORM__;
  }
  try {
    return sessionStorage.getItem("memories_windapp_platform");
  } catch {
    return null;
  }
}

export function isWindappMac(): boolean {
  return getWindappPlatform() === "darwin";
}

/** True when Memories is running inside free_file/windapp. */
export function detectWindapp(): boolean {
  if (typeof window === "undefined") return false;
  if (window.__MEMORIES_WINDAPP__ || window.memoriesWindapp?.isDesktop) return true;
  try {
    if (sessionStorage.getItem("memories_windapp") === "1") return true;
  } catch {
    /* ignore */
  }
  try {
    return new URLSearchParams(window.location.search).get("windapp") === "1";
  } catch {
    return false;
  }
}

/**
 * The desktop app's native window-fullscreen bridge, or null when unavailable
 * (browser, or an old windapp build without the API). The player uses this
 * instead of the HTML5 Fullscreen API, which misbehaves in the frameless
 * Electron window.
 */
export function windappFullscreenBridge(): {
  setFullScreen: (on: boolean) => Promise<boolean>;
  onFullscreenChange?: (callback: (on: boolean) => void) => () => void;
} | null {
  if (typeof window === "undefined") return null;
  const wa = window.memoriesWindapp;
  if (!wa?.isDesktop || typeof wa.setFullScreen !== "function") return null;
  return { setFullScreen: wa.setFullScreen, onFullscreenChange: wa.onFullscreenChange };
}

/**
 * Marks <html class="windapp"> and persists the flag across client navigations.
 * Call once from the root layout.
 */
export function useWindapp(): boolean {
  const [isWindapp, setIsWindapp] = useState(() =>
    typeof window !== "undefined" ? detectWindapp() : false,
  );

  useEffect(() => {
    const active = detectWindapp();
    if (!active) return;

    document.documentElement.classList.add("windapp");
    if (getWindappPlatform() === "darwin") {
      document.documentElement.classList.add("windapp-mac");
    }
    window.__MEMORIES_WINDAPP__ = true;
    try {
      sessionStorage.setItem("memories_windapp", "1");
      const p = getWindappPlatform();
      if (p) sessionStorage.setItem("memories_windapp_platform", p);
    } catch {
      /* ignore */
    }
    setIsWindapp(true);

    const onDragStart = (e: DragEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest("a, [href], img, picture")) e.preventDefault();
    };
    document.addEventListener("dragstart", onDragStart, true);

    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has("windapp")) {
        url.searchParams.delete("windapp");
        window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      }
    } catch {
      /* ignore */
    }

    return () => {
      document.removeEventListener("dragstart", onDragStart, true);
    };
  }, []);

  return isWindapp;
}
