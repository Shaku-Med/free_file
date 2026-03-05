import { useEffect, useRef } from "react";
import { useLocation, useNavigation } from "react-router";
import { useFileContext } from "~/lib/Context/Context";

const STORAGE_KEY = "scroll_restoration_data";
const WAIT_FOR_DATA_MS = 3000;

interface ScrollData {
  scrollTop: number;
  scrollLeft: number;
}

type ScrollRestorationData = {
  [path: string]: ScrollData;
};

const getScrollContainer = (): HTMLElement | null => {
  return document.getElementById("scroll_container");
};

const getStoredData = (): ScrollRestorationData => {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
};

const saveScrollData = (path: string, data: ScrollData) => {
  try {
    const stored = getStoredData();
    stored[path] = data;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    return;
  }
};

const getScrollData = (path: string): ScrollData | null => {
  try {
    const stored = getStoredData();
    return stored[path] || null;
  } catch {
    return null;
  }
};

function doRestore(container: HTMLElement, savedData: ScrollData, isRestoringRef: { current: boolean }) {
  isRestoringRef.current = true;
  let attempts = 0;
  const maxAttempts = 20;

  const restoreScroll = () => {
    attempts++;
    const canScroll = container.scrollHeight > savedData.scrollTop;

    if (canScroll || attempts >= maxAttempts) {
      container.scrollTop = savedData.scrollTop;
      container.scrollLeft = savedData.scrollLeft;
      setTimeout(() => {
        container.scrollTop = savedData.scrollTop;
        container.scrollLeft = savedData.scrollLeft;
        isRestoringRef.current = false;
      }, 100);
    } else {
      requestAnimationFrame(restoreScroll);
    }
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(restoreScroll);
  });
}

export default function ScrollRestoration() {
  const location = useLocation();
  const nav = useNavigation();
  const { scrollDataReady, setScrollDataReady } = useFileContext();
  const isRestoringRef = useRef(false);
  const currentPathRef = useRef<string>("");
  const restoredForPathRef = useRef<string>("");

  // On pathname change: save previous scroll, clear "data ready", reset restored flag
  useEffect(() => {
    const container = getScrollContainer();
    if (!container) return;

    const currentPath = location.pathname;

    if (currentPathRef.current && currentPathRef.current !== currentPath) {
      const scrollData: ScrollData = {
        scrollTop: container.scrollTop,
        scrollLeft: container.scrollLeft,
      };
      saveScrollData(currentPathRef.current, scrollData);
      setScrollDataReady(false);
      restoredForPathRef.current = "";
    }

    currentPathRef.current = currentPath;

    if (currentPath.startsWith("/reel")) {
      setScrollDataReady(true);
      container.scrollTop = 0;
      container.scrollLeft = 0;
      return;
    }

    const savedData = getScrollData(currentPath);
    if (!savedData) {
      container.scrollTop = 0;
      container.scrollLeft = 0;
    }
    // If we have savedData, we don't restore here — wait for data-ready effect
  }, [location.pathname, nav.location, setScrollDataReady]);

  // Wait for current route data to load before restoring scroll position
  useEffect(() => {
    const container = getScrollContainer();
    if (!container) return;

    const currentPath = location.pathname;
    if (currentPath.startsWith("/reel")) return;

    const savedData = getScrollData(currentPath);
    if (!savedData || restoredForPathRef.current === currentPath) return;

    const runRestore = () => {
      if (restoredForPathRef.current === currentPath) return;
      restoredForPathRef.current = currentPath;
      doRestore(container, savedData, isRestoringRef);
    };

    if (scrollDataReady) {
      runRestore();
      return;
    }

    const timeoutId = setTimeout(runRestore, WAIT_FOR_DATA_MS);
    return () => clearTimeout(timeoutId);
  }, [location.pathname, scrollDataReady]);

  // Attach scroll listener to persist position (and reset ready when path changes is handled above)
  useEffect(() => {
    const container = getScrollContainer();
    if (!container) return;

    const currentPath = location.pathname;

    const handleScroll = () => {
      if (!isRestoringRef.current) {
        const scrollData: ScrollData = {
          scrollTop: container.scrollTop,
          scrollLeft: container.scrollLeft,
        };
        saveScrollData(currentPath, scrollData);
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [location.pathname]);

  return null;
}

