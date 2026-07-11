import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { isMobile } from "react-device-detect";
import { cn } from "~/lib/utils";
import { usePlayerContext } from "../PlayerContext";

/** Fallback when ControlBar hasn't measured yet (reels only have the seek strip below). */
function fallbackReelInfoBottom(mobileLayout: boolean): string {
  return mobileLayout
    ? "calc(3rem + max(0.75rem, env(safe-area-inset-bottom, 0px)))"
    : "3rem";
}

function usePlayerMobileLayout(): boolean {
  const [mobileLayout, setMobileLayout] = useState(isMobile);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    const update = () => setMobileLayout(isMobile || mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  return mobileLayout;
}

export interface ReelInfoOverlayProps {
  children: ReactNode;
  /** Leave room for the TikTok-style action rail on narrow viewports. */
  reserveActionRail?: boolean;
  className?: string;
}

/**
 * Reel metadata layer inside the player — sits just above the seek strip.
 * Reel chrome lives at the top of the player now, so this never lifts.
 */
export function ReelInfoOverlay({
  children,
  reserveActionRail = true,
  className,
}: ReelInfoOverlayProps) {
  const { reelEmbedAutoHide, reelChromeBottomReservePx } = usePlayerContext();
  const mobileLayout = usePlayerMobileLayout();

  const bottom =
    reelEmbedAutoHide && reelChromeBottomReservePx > 0
      ? `${reelChromeBottomReservePx}px`
      : fallbackReelInfoBottom(mobileLayout);

  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[28] h-[min(38%,11rem)] bg-gradient-to-t from-black/95 via-black/55 to-transparent"
      />
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 z-[29] max-w-full transition-[bottom] duration-300 ease-out",
          reserveActionRail && "pr-[4.25rem] sm:pr-[4.5rem] lg:pr-4",
          className,
        )}
        style={{ bottom }}
      >
        <div className="pointer-events-auto px-3 pb-1 lg:px-4">{children}</div>
      </div>
    </>
  );
}
