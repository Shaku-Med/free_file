import { useEffect, useRef } from "react";
import { ThumbsUp } from "lucide-react";
import { cn } from "~/lib/utils";

export type ReelLikeFlyBurst = {
  id: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

type ReelDoubleTapLikeBurstProps = {
  burst: ReelLikeFlyBurst;
  onComplete: (id: number) => void;
  onArrive?: (id: number) => void;
};

const FLY_MS = 880;
/** When the flying thumb reaches the action-rail like target. */
const ARRIVE_AT_MS = Math.round(FLY_MS * 0.72);

/** Double-tap like: thumbs-up pops at the tap, then flies into the action-rail like button. */
export function ReelDoubleTapLikeBurst({ burst, onComplete, onArrive }: ReelDoubleTapLikeBurstProps) {
  const arrivedRef = useRef(false);
  const dx = burst.endX - burst.startX;
  const dy = burst.endY - burst.startY;
  const size = 96;

  useEffect(() => {
    arrivedRef.current = false;
    const arriveTimer = window.setTimeout(() => {
      if (arrivedRef.current) return;
      arrivedRef.current = true;
      onArrive?.(burst.id);
    }, ARRIVE_AT_MS);
    return () => window.clearTimeout(arriveTimer);
  }, [burst.id, onArrive]);

  return (
    <div
      className="reel-like-fly-burst pointer-events-none absolute z-[31]"
      style={
        {
          left: burst.startX,
          top: burst.startY,
          width: size,
          height: size,
          "--fly-dx": `${dx}px`,
          "--fly-dy": `${dy}px`,
          animationDuration: `${FLY_MS}ms`,
        } as React.CSSProperties
      }
      onAnimationEnd={() => onComplete(burst.id)}
    >
      <div className="reel-like-fly-burst__halo absolute inset-0 rounded-full" aria-hidden />
      <ThumbsUp
        className={cn(
          "reel-like-fly-burst__icon absolute inset-0 m-auto h-[4.5rem] w-[4.5rem]",
          "fill-white text-white",
        )}
        aria-hidden
      />
    </div>
  );
}
