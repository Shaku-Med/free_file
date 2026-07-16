type MiniDragHandler = (e: PointerEvent) => void;

let handler: MiniDragHandler | null = null;
/** Separate locks so mobile-bar ↔ desktop resize and VR don't fight each other. */
let mobileBarLock = false;
let vrLock = false;

function syncDragLocked() {
  // Prefer explicit OR of both sources — never leave a stale lock after resize.
  return mobileBarLock || vrLock;
}

let dragLocked = false;

function applyLock() {
  dragLocked = syncDragLocked();
}

export function registerMiniPlayerDragHandler(next: MiniDragHandler | null) {
  handler = next;
}

/** Music-bar mode (≤700px): always lock. Cleared when leaving that layout. */
export function setMiniPlayerMobileBarDragLock(locked: boolean) {
  mobileBarLock = locked;
  applyLock();
}

/** VR theater on floating mini: lock while active. */
export function setMiniPlayerVrDragLock(locked: boolean) {
  vrLock = locked;
  applyLock();
}

/** @deprecated Prefer setMiniPlayerMobileBarDragLock / setMiniPlayerVrDragLock */
export function setMiniPlayerDragLocked(locked: boolean) {
  // Treat as both cleared or both set only when callers still use the old API.
  mobileBarLock = locked;
  vrLock = locked;
  applyLock();
}

export function isMiniPlayerDragLocked() {
  return dragLocked;
}

export function dispatchMiniPlayerDrag(e: PointerEvent) {
  if (dragLocked) return;
  handler?.(e);
}
