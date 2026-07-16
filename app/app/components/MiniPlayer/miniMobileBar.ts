import { useEffect, useState } from "react";

/** Viewports at or below this use the fixed music-bar mini player. */
export const MINI_MOBILE_BAR_MAX_PX = 700;

export const MINI_MOBILE_BAR_MQ = `(max-width: ${MINI_MOBILE_BAR_MAX_PX}px)`;

export function useMiniMobileBar(): boolean {
  const [isMobileBar, setIsMobileBar] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(MINI_MOBILE_BAR_MQ).matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(MINI_MOBILE_BAR_MQ);
    const update = () => setIsMobileBar(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  return isMobileBar;
}
