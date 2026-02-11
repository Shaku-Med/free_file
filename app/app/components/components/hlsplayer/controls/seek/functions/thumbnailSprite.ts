import type { ThumbnailSpriteMeta } from '../../../PlayerContext';

export interface SpriteFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  time: number;
}

export function getFrameAtTime(meta: ThumbnailSpriteMeta, time: number): SpriteFrame | null {
  if (!meta || !meta.cells || meta.cells.length === 0) return null;

  let idx = meta.cells.findIndex(c => time >= c.start && time < c.end);
  if (idx === -1) idx = meta.cells.length - 1;

  const col = idx % meta.cols;
  const row = Math.floor(idx / meta.cols);

  return {
    x: col * meta.cellSize,
    y: row * meta.cellSize,
    width: meta.cellSize,
    height: meta.cellSize,
    time: meta.cells[idx].start,
  };
}
