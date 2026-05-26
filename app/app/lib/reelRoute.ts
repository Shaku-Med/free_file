/** True on `/reel` and `/reel/:uniqueId` — fullscreen feed; sidebar is sheet-only. */
export function isReelRoute(pathname: string): boolean {
  return pathname === "/reel" || pathname.startsWith("/reel/");
}
