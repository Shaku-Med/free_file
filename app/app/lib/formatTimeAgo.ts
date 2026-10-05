/** Relative time strings matching VideoCard / feed copy ("2 days ago", "1 day ago"). */
export function formatTimeAgo(date: string | Date): string {
  const now = new Date();
  const past = new Date(date);
  const diffInSeconds = Math.floor((now.getTime() - past.getTime()) / 1000);

  if (diffInSeconds < 60) return "just now";
  if (diffInSeconds < 3600) return ago(Math.floor(diffInSeconds / 60), "minute");
  if (diffInSeconds < 86400) return ago(Math.floor(diffInSeconds / 3600), "hour");
  if (diffInSeconds < 2592000) return ago(Math.floor(diffInSeconds / 86400), "day");
  if (diffInSeconds < 31536000) return ago(Math.floor(diffInSeconds / 2592000), "month");
  return ago(Math.floor(diffInSeconds / 31536000), "year");
}

function ago(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}
