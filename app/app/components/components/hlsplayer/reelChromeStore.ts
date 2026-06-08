// Shared reel control-chrome visibility. All reel players read/write this one
// value so a toggle on one applies to all, and scrolling to a new reel inherits
// the current state (hidden by default — no flash on every scroll).
let visible = false;
const subs = new Set<(v: boolean) => void>();

export const reelChromeStore = {
  get: () => visible,
  set: (v: boolean) => {
    if (visible === v) return;
    visible = v;
    subs.forEach((fn) => {
      try {
        fn(v);
      } catch {
        /* listener errors are non-fatal */
      }
    });
  },
  subscribe: (fn: (v: boolean) => void) => {
    subs.add(fn);
    return () => {
      subs.delete(fn);
    };
  },
};
