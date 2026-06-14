import { useEffect, useState } from "react";

/** How tightly the reel action rail packs on short viewports. */
export type ReelActionRailDensity = "comfortable" | "compact" | "minimal";

function resolveReelActionRailDensity(viewportHeight: number): ReelActionRailDensity {
  if (viewportHeight <= 640) return "minimal";
  if (viewportHeight <= 720) return "compact";
  return "comfortable";
}

/** Shrinks reel action buttons on short screens (SE-sized phones, landscape, etc.). */
export function useReelActionRailDensity(): ReelActionRailDensity {
  const [density, setDensity] = useState<ReelActionRailDensity>(() =>
    typeof window === "undefined" ? "comfortable" : resolveReelActionRailDensity(window.innerHeight),
  );

  useEffect(() => {
    const update = () => setDensity(resolveReelActionRailDensity(window.innerHeight));
    update();

    const compactMq = window.matchMedia("(max-height: 720px)");
    const minimalMq = window.matchMedia("(max-height: 640px)");
    compactMq.addEventListener("change", update);
    minimalMq.addEventListener("change", update);
    window.addEventListener("resize", update);

    return () => {
      compactMq.removeEventListener("change", update);
      minimalMq.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return density;
}
