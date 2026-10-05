/** True on `/reel` and `/reel/:uniqueId`, the full height reel feed. */
export function isReelRoute(pathname: string): boolean {
  return pathname === "/reel" || pathname.startsWith("/reel/");
}
