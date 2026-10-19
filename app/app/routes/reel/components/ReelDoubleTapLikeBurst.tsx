import { useEffect, useMemo } from "react";
import { ThumbsUp } from "lucide-react";

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

const BURST_MS = 1000;
/** When the flying thumb reaches the action-rail like target. */
const ARRIVE_AT_MS = 860;
const SPARKS = 10;

/**
 * Double tap like, the same as the app's: the thumb springs in with a tilt over
 * a soft glow, a ring ripples out and sparks fly off it, then the thumb arcs
 * into the action-rail like button. The arc comes from moving x and y on
 * separate elements with different easing.
 */
export function ReelDoubleTapLikeBurst({ burst, onComplete, onArrive }: ReelDoubleTapLikeBurstProps) {
  const { tilt, sparks } = useMemo(() => {
    const turn = Math.random() * Math.PI * 2;
    return {
      tilt: (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 10),
      sparks: Array.from({ length: SPARKS }, (_, i) => {
        const angle = turn + (i / SPARKS) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
        const reach = 54 + Math.random() * 34;
        return {
          x: Math.cos(angle) * reach,
          y: Math.sin(angle) * reach,
          size: 5 + Math.random() * 4,
          delay: 70 + Math.random() * 60,
          white: i % 2 === 1,
        };
      }),
    };
  }, []);

  useEffect(() => {
    const arrive = window.setTimeout(() => onArrive?.(burst.id), ARRIVE_AT_MS);
    const done = window.setTimeout(() => onComplete(burst.id), BURST_MS);
    return () => {
      window.clearTimeout(arrive);
      window.clearTimeout(done);
    };
  }, [burst.id, onArrive, onComplete]);

  return (
    <div
      className="reel-like-burst pointer-events-none absolute z-[31]"
      style={
        {
          left: burst.startX,
          top: burst.startY,
          "--fly-dx": `${burst.endX - burst.startX}px`,
          "--fly-dy": `${burst.endY - burst.startY}px`,
          "--tilt": `${tilt}deg`,
        } as React.CSSProperties
      }
      aria-hidden
    >
      <span className="reel-like-burst__glow" />
      <span className="reel-like-burst__ring" />
      {sparks.map((s, i) => (
        <span
          key={i}
          className={s.white ? "reel-like-burst__spark reel-like-burst__spark--white" : "reel-like-burst__spark"}
          style={
            {
              width: s.size,
              height: s.size,
              "--spark-x": `${s.x}px`,
              "--spark-y": `${s.y}px`,
              animationDelay: `${s.delay}ms`,
            } as React.CSSProperties
          }
        />
      ))}
      <span className="reel-like-burst__fly-x">
        <span className="reel-like-burst__fly-y">
          <span className="reel-like-burst__thumb">
            <ThumbsUp className="h-[4.5rem] w-[4.5rem] fill-white text-white" />
          </span>
        </span>
      </span>
    </div>
  );
}
