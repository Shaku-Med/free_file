/**
 * Home route  `/` (index).
 *
 * The actual feed UI lives in `<PersistentHomeView />` mounted at the
 * AppShell level so it stays MOUNTED when the user navigates to a watch
 * / reel route. That preserves scroll position, infinite-scroll observer
 * state, the IntersectionObserver-driven autoplay logic, and any
 * internal refs across modal navigation.
 *
 * The route still matches `/` so:
 *   - `meta` below runs for SEO (canonical title + description)
 *   - SSR HTML for `/` is correct
 *   - Browser-back from any other route still navigates here
 *
 * The persistent view's visibility is toggled in `BodyComponent` based
 * on `pathname === "/"`  no extra wiring needed at this level.
 */

import type { MetaFunction } from "react-router";
import { buildPageMeta } from "~/lib/seo";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Memories – Your feed of photos and videos",
    description:
      "Discover and watch photos and videos on your personalized feed. Upload your own, like, comment, and share with the Memories community.",
    canonicalPath: "/",
  });

export default function HomeRouteMarker() {
  return null;
}
