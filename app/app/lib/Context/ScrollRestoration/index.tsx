import { useEffect, useRef } from "react";
import { useLocation, useNavigation } from "react-router";

const STORAGE_KEY = "scroll_restoration_data";

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

export default function ScrollRestoration() {
  const location = useLocation();
  const isRestoringRef = useRef(false);
  const currentPathRef = useRef<string>("");
  const nav = useNavigation()

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
    }

    currentPathRef.current = currentPath;

    if (currentPath.startsWith("/reel")) {
      container.scrollTop = 0;
      container.scrollLeft = 0;
      return;
    }

    const savedData = getScrollData(currentPath);
    if (savedData) {
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
        requestAnimationFrame(() => {
          restoreScroll();
        });
      });
    } else {
      container.scrollTop = 0;
      container.scrollLeft = 0;
    }

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

    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [location.pathname, nav.location]);

  return null;
}

