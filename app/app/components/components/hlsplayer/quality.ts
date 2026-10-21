/**
 * A rendition's quality the way YouTube names it, by its short side: a 720x1280
 * reel is 720p, not 1280p. Landscape video is unchanged since its short side is
 * its height.
 */
export function qualityLines(level: { width?: number; height: number }): number {
  return level.width && level.width > 0 ? Math.min(level.width, level.height) : level.height;
}
