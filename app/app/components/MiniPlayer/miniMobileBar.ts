import { useEffect, useState } from "react";

/** Viewports at or below this use the fixed music-bar mini player. */
export const MINI_MOBILE_BAR_MAX_PX = 700;

export const MINI_MOBILE_BAR_MQ = `(max-width: ${MINI_MOBILE_BAR_MAX_PX}px)`;

/** The phone mini player is the app's floating card, this tall. */
export const MINI_MOBILE_BAR_H_PX = 64;
/** The scrub band along the bottom of the card, under the thin progress line, in the docked player. */
export const MINI_MOBILE_SEEK_HIT_PX = 12;
/** How far the line sits above the card's bottom edge, and in from its sides. */
export const MINI_MOBILE_SEEK_INSET_PX = { bottom: 3, side: 14 };
/** Lifts the scrub preview from the seek band to just above the card. */
export const MINI_MOBILE_PREVIEW_LIFT_PX = MINI_MOBILE_BAR_H_PX - MINI_MOBILE_SEEK_INSET_PX.bottom - MINI_MOBILE_SEEK_HIT_PX + 8;

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
