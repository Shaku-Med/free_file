// Auto-scales between B / KB / MB / GB / TB so labels stay readable for small
// uploads ("15 MB") and big ones ("1.2 TB"). Used everywhere.
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const tb = bytes / 1024 ** 4;
  if (tb >= 1) return `${tb.toFixed(tb >= 10 ? 0 : 1)} TB`;
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  const mb = bytes / 1024 ** 2;
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  const kb = bytes / 1024;
  if (kb >= 1) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  return `${bytes} B`;
}

// Fixed MB form used in hover tooltips so users can always read a precise
// number regardless of which auto-scaled unit the visible label picked.
export function formatMB(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / 1024 ** 2;
  if (mb >= 100) return `${Math.round(mb).toLocaleString()} MB`;
  if (mb >= 10) return `${mb.toFixed(1)} MB`;
  return `${mb.toFixed(2)} MB`;
}
