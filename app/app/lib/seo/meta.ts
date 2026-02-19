import type { MetaDescriptor } from "react-router";
import { BASE_URL } from "../URLS";
import {
  SITE_NAME,
  DEFAULT_TITLE,
  DEFAULT_DESCRIPTION,
  DEFAULT_KEYWORDS,
  DEFAULT_OG_IMAGE_PATH,
  FAVICON_PATH,
  APPLE_TOUCH_ICON_PATH,
  MANIFEST_PATH,
  ICON_192_PATH,
  ICON_512_PATH,
  LOCALE,
} from "./constants";

const defaultOgImage = `${BASE_URL}${DEFAULT_OG_IMAGE_PATH}`;
const canonicalUrl = BASE_URL;

const FAVICON_LINKS: MetaDescriptor[] = [
  { rel: "icon", href: FAVICON_PATH, type: "image/x-icon", sizes: "any" },
  { rel: "shortcut icon", href: FAVICON_PATH },
  { rel: "icon", href: ICON_192_PATH, type: "image/png", sizes: "192x192" },
  { rel: "icon", href: ICON_512_PATH, type: "image/png", sizes: "512x512" },
  { rel: "apple-touch-icon", href: APPLE_TOUCH_ICON_PATH },
  { rel: "manifest", href: MANIFEST_PATH },
];

export function buildDefaultMeta(): MetaDescriptor[] {
  return [
    ...FAVICON_LINKS,
    { title: DEFAULT_TITLE },
    { name: "description", content: DEFAULT_DESCRIPTION },
    { name: "keywords", content: DEFAULT_KEYWORDS },
    { name: "author", content: SITE_NAME },
    { name: "canonical", content: canonicalUrl },
    {
      name: "robots",
      content:
        "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
    },
    {
      name: "googlebot",
      content:
        "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
    },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:title", content: DEFAULT_TITLE },
    { property: "og:description", content: DEFAULT_DESCRIPTION },
    { property: "og:image", content: defaultOgImage },
    { property: "og:image:alt", content: SITE_NAME },
    { property: "og:url", content: canonicalUrl },
    { property: "og:locale", content: LOCALE },
    { property: "og:image:width", content: "512" },
    { property: "og:image:height", content: "512" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:site", content: SITE_NAME },
    { name: "twitter:title", content: DEFAULT_TITLE },
    { name: "twitter:description", content: DEFAULT_DESCRIPTION },
    { name: "twitter:image", content: defaultOgImage },
    { name: "twitter:image:alt", content: SITE_NAME },
    { rel: "canonical", href: canonicalUrl },
    { rel: "dns-prefetch", href: BASE_URL },
  ];
}

export function buildErrorMeta(): MetaDescriptor[] {
  return [
    ...FAVICON_LINKS,
    { title: "Error" },
    { name: "description", content: "Error loading data." },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export type PageMetaInput = {
  title: string;
  description: string;
  canonicalPath?: string;
  ogImage?: string;
  ogImageAlt?: string;
  keywords?: string;
  author?: string;
  noindex?: boolean;
  ogType?: "website" | "article" | "profile" | "video.other" | "image";
  extra?: MetaDescriptor[];
};

export function buildPageMeta(input: PageMetaInput): MetaDescriptor[] {
  const {
    title,
    description,
    canonicalPath = "",
    ogImage,
    ogImageAlt,
    keywords = DEFAULT_KEYWORDS,
    author = SITE_NAME,
    noindex = false,
    ogType = "website",
    extra = [],
  } = input;
  const canonical = canonicalPath
    ? `${BASE_URL}${canonicalPath.startsWith("/") ? "" : "/"}${canonicalPath}`
    : canonicalUrl;
  const image = ogImage ? (ogImage.startsWith("http") ? ogImage : `${BASE_URL}${ogImage}`) : defaultOgImage;
  const robots = noindex
    ? "noindex, nofollow"
    : "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";

  return [
    { title },
    { name: "description", content: description },
    { name: "keywords", content: keywords },
    { name: "author", content: author },
    { name: "canonical", content: canonical },
    { name: "robots", content: robots },
    ...(noindex ? [] : [{ name: "googlebot", content: robots }]),
    { property: "og:type", content: ogType },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: image },
    { property: "og:image:alt", content: ogImageAlt ?? title },
    { property: "og:url", content: canonical },
    { property: "og:locale", content: LOCALE },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
    { name: "twitter:image:alt", content: ogImageAlt ?? title },
    { rel: "canonical", href: canonical },
    ...extra,
  ];
}
