// Exact upload date for expanded descriptions, e.g. "2025-05-07 at 4:32 PM".
export function formatExactDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const h24 = d.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} at ${h12}:${pad(d.getMinutes())} ${h24 < 12 ? "AM" : "PM"}`;
}
