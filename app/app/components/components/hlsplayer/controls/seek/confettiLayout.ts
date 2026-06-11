import type { ConfettiRuntimeConfig } from '../../confettiSettings';

export type PlayerRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export const MINI_PLAYER_Z = 2147483646;
export const CONFETTI_Z_ABOVE_MINI = MINI_PLAYER_Z + 1;

export function stackZAbovePlayer(root: HTMLElement): number {
  let maxZ = 0;
  let node: HTMLElement | null = root;
  while (node && node !== document.documentElement) {
    const { position, zIndex } = getComputedStyle(node);
    if (position !== 'static' && zIndex !== 'auto') {
      const z = Number.parseInt(zIndex, 10);
      if (!Number.isNaN(z)) maxZ = Math.max(maxZ, z);
    }
    node = node.parentElement;
  }
  return Math.max(maxZ + 8, 48);
}

export function readAnchorRect(anchor: HTMLElement): PlayerRect | null {
  const r = anchor.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

export function applyWrapLayout(
  wrap: HTMLDivElement,
  rect: PlayerRect,
  rt: ConfettiRuntimeConfig,
  stackZ: number,
) {
  wrap.style.left = `${rect.left - rt.spillSide}px`;
  wrap.style.top = `${rect.top - rt.spillTop}px`;
  wrap.style.width = `${rect.width + rt.spillSide * 2}px`;
  wrap.style.height = `${rect.height + rt.spillTop + rt.spillBottom}px`;
  wrap.style.zIndex = String(stackZ);
}
