import type { MetaFunction } from "react-router";
import { buildPageMeta } from "~/lib/seo";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Posts – Photos on Memories",
    description: "Browse photos shared by creators on Memories.",
    canonicalPath: "/posts",
  });

// The page itself is PersistentPostsView, which BodyComponent keeps mounted.
export default function PostsRouteMarker() {
  return null;
}
