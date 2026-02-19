import React from "react";
import type { MetaFunction } from "react-router";
import Search from "./Dynamic/index";
import { buildPageMeta } from "~/lib/seo";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Search photos and videos | Memories",
    description:
      "Search Memories for photos, videos, and creators. Find content by keyword, category, or tag and explore trending uploads.",
    canonicalPath: "/search",
  });

export default function SearchIndex() {
  return (
    <div>
      <Search />
    </div>
  );
}