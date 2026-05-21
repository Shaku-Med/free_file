import { useState, useEffect, useLayoutEffect, type RefObject } from "react";

/** Tracks the HLS player shell size (the element with `containerRef`) — not the viewport. */
export function usePlayerContainerSize(containerRef: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        setSize((prev) =>
          prev.width === r.width && prev.height === r.height
            ? prev
            : { width: r.width, height: r.height },
        );
      });
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [containerRef]);

  return size;
}

/** Responsive end-screen / end-card layout derived from the player box, not the viewport. */
export function playerEndUiLayout(playerW: number, playerH: number) {
  return {
    sideBySideReplay: playerW >= 420 && playerH >= 360,
    twoColumnSuggest: playerW >= 640 && playerH >= 400,
    roomierPadding: playerW >= 380,
    largerType: playerW >= 440,
    replayRailWidth: playerW >= 500,
    endCardGridCols: playerW >= 520 ? 4 : playerW >= 260 ? 2 : 1,
    controlsClearancePx:
      playerH >= 480 ? 88 : playerH >= 360 ? 100 : playerH > 0 ? 132 : 100,
  };
}
