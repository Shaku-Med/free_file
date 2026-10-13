import { useEffect } from "react";

/**
 * Publishes the visible viewport as `--app-vvh` and `--app-vv-top`. On iOS,
 * especially installed to the home screen, the layout viewport can be taller
 * than what's on screen and the keyboard only shrinks the visual one, so
 * anything sized from `100dvh` or pinned with `bottom` can end up off screen.
 */
export default function ViewportVars() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement.style;
    let frame = 0;
    const publish = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        root.setProperty("--app-vvh", `${vv.height}px`);
        root.setProperty("--app-vv-top", `${Math.max(0, vv.offsetTop)}px`);
      });
    };
    publish();
    vv.addEventListener("resize", publish);
    vv.addEventListener("scroll", publish);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", publish);
      vv.removeEventListener("scroll", publish);
      root.removeProperty("--app-vvh");
      root.removeProperty("--app-vv-top");
    };
  }, []);

  return null;
}
