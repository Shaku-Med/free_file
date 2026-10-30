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

  // The reel page lets the video run under the tab bar; the caption stays above it.
  const above =
    reelEmbedAutoHide && reelChromeBottomReservePx > 0
      ? `${reelChromeBottomReservePx}px`
      : fallbackReelInfoBottom(mobileLayout);
  const bottom = `calc(${above} + var(--reel-bottom-inset, 0px))`;

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 z-[29] max-w-full transition-[bottom] duration-300 ease-out",
        reserveActionRail && "pr-[4.25rem] sm:pr-[4.5rem] lg:pr-4",
        className,
      )}
      style={{ bottom }}
    >
      {/* The shade runs from the frame's bottom to just above the text, however
          long the caption, so white text stays readable over a light letterbox. */}
      <div
        aria-hidden
        className="absolute inset-x-0 -top-12 -z-10"
        style={{
          bottom: `calc(-1 * ${bottom})`,
          backgroundImage: "linear-gradient(to top, rgb(0 0 0 / 0.95), rgb(0 0 0 / 0.6) calc(100% - 3rem), transparent)",
        }}
      />
      <div className="pointer-events-auto px-3 pb-1 lg:px-4">{children}</div>
    </div>
  );
}
