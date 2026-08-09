
import type { MetaFunction } from "react-router";
import { buildPageMeta } from "~/lib/seo";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Memories - Your feed of photos and videos",
    description:
      "Discover and watch photos and videos on your personalized feed. Upload your own, like, comment, and share with the Memories community.",
    canonicalPath: "/",
  });

export default function HomeRouteMarker() {
  return null;
}
