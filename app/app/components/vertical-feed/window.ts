/** Indices to mount: [active-1, active, active+1], trimmed at edges. */
export function getVisibleIndices(activeIndex: number, length: number): number[] {
  if (length <= 0) return [];
  const out: number[] = [];
  for (let i = activeIndex - 1; i <= activeIndex + 1; i++) {
    if (i >= 0 && i < length) out.push(i);
  }
  return out;
}
