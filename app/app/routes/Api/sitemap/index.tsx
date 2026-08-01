import db from "~/lib/Database/supabase";
import { BASE_URL } from "~/lib/URLS";
import { filterFilesByAccess } from "../fun/accessControl";

/**
 * Sitemap API
 *
 * Public endpoint  no auth (Google / Bing / IndexNow need to fetch this
 * anonymously). The response surface is therefore the public-internet
 * threat boundary; everything here is defensive on that basis:
 *
 *  - XML escape every interpolated value (defends against stored XML
 *    injection if a unique_id / username ever contained `<`, `>`, `&`).
 *  - Push access-control filters to the database (is_public, !is_adult,
 *    upload_status, !is_reel) so we don't pull rows we're just going to
 *    drop in JS. This is also the fix for the "too much data" symptom
 *    the previous version hit `get_feed` with limit=50000 and returned
 *    100+ MB of fully enriched rows just to extract two columns.
 *  - Filter limits per sub-sitemap; sitemap index points at the right
 *    sub-pages. Sitemap protocol allows ≤ 50 000 URLs / ≤ 50 MB per
 *    file, but we cap at 10 000 to keep memory + cold latency sane.
 *  - Reuse `filterFilesByAccess` as a belt-and-suspenders defence so
 *    any schema drift (a row sneaking past the DB-level filter) still
 *    can't leak into search engines.
 *  - Allow GET / HEAD only.
 *  - Generic error bodies  no server-side detail leaks to the client.
 */

const MAX_FILE_URLS = 10_000;
const MAX_PROFILE_URLS = 10_000;
const MAIN_SITEMAP_RECENT_LIMIT = 500;
/** Acceptable values for the `?type=` parameter. */
const VALID_TYPES = new Set(["index", "main", "profiles", "files"]);

const STATIC_PAGES = [
  { path: "", priority: "1.0", changefreq: "daily" },
  { path: "privacy", priority: "0.3", changefreq: "monthly" },
  { path: "terms", priority: "0.3", changefreq: "monthly" },
  { path: "search", priority: "0.8", changefreq: "daily" },
  { path: "features/incoming", priority: "0.5", changefreq: "weekly" },
  { path: "reel", priority: "0.9", changefreq: "daily" },
] as const;

/**
 * Escape characters that have a special meaning in XML. We use this on EVERY
 * interpolated value going into the response  even values we currently
 * believe are safe (BASE_URL, date strings)  so that future code changes
 * can't accidentally introduce an injection vector. Cheaper than auditing
 * each call site forever.
 */
const xmlEscape = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const formatDate = (date: string | Date | null | undefined): string => {
  if (!date) return new Date().toISOString().split("T")[0]!;
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return new Date().toISOString().split("T")[0]!;
  return d.toISOString().split("T")[0]!;
};

const xmlResponse = (body: string, status = 200): Response =>
  new Response(body, {
    status,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // 1 h fresh, 24 h stale-while-revalidate. Cold hits get an instant
      // (stale) response while the edge revalidates in the background.
      "Cache-Control":
        "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });

const errorResponse = (status = 500): Response =>
  new Response("Something went wrong.", {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });

const generateSitemapXML = (
  urls: Array<{
    loc: string;
    lastmod?: string;
    changefreq?: string;
    priority?: string;
  }>,
): string => {
  const urlEntries = urls
    .map((url) => {
      let entry = `    <url>\n      <loc>${xmlEscape(url.loc)}</loc>`;
      if (url.lastmod) entry += `\n      <lastmod>${xmlEscape(url.lastmod)}</lastmod>`;
      if (url.changefreq) entry += `\n      <changefreq>${xmlEscape(url.changefreq)}</changefreq>`;
      if (url.priority) entry += `\n      <priority>${xmlEscape(url.priority)}</priority>`;
      entry += `\n    </url>`;
      return entry;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
        http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
${urlEntries}
</urlset>`;
};

const generateSitemapIndex = (
  sitemaps: Array<{ loc: string; lastmod: string }>,
): string => {
  const sitemapEntries = sitemaps
    .map(
      (sitemap) =>
        `    <sitemap>\n      <loc>${xmlEscape(sitemap.loc)}</loc>\n      <lastmod>${xmlEscape(sitemap.lastmod)}</lastmod>\n    </sitemap>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries}
</sitemapindex>`;
};

/**
 * Minimal file fetch for sitemap use. Only pulls the columns we need:
 *  - unique_id, created_at: emitted into the XML
 *  - is_adult, is_public, owner_id, upload_status: required by
 *    `filterFilesByAccess` (defence-in-depth)
 *
 * Filtering pushed to the DB so an anonymous sitemap request never pulls
 * private / adult / draft / reel rows it would just throw away in JS.
 * This is the single biggest win vs the old `get_feed`-based version.
 */
const fetchPublicFilesForSitemap = async (limit: number) => {
  if (!db) return null;
  const { data, error } = await db
    .from("files")
    .select("unique_id, created_at, is_adult, is_public, visibility, owner_id, upload_status")
    .eq("is_public", true)
    .eq("is_adult", false)
    .eq("is_reel", false)
    .in("upload_status", ["completed", "complete"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return null;
  return data ?? [];
};

const fetchPublicProfilesForSitemap = async (limit: number) => {
  if (!db) return null;
  const { data, error } = await db
    .from("users")
    .select("username, created_at")
    .eq("is_memories", false)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return null;
  return data ?? [];
};

export const loader = async ({ request }: { request: Request }) => {
  // Public sitemap endpoint  read-only. Anything other than a plain GET
  // or HEAD is rejected outright; we never want a sitemap URL accepting
  // state-changing methods.
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    if (!db) return errorResponse();

    const url = new URL(request.url);
    const requestedType = url.searchParams.get("type");
    const sitemapType = requestedType && VALID_TYPES.has(requestedType)
      ? requestedType
      : "index";

    // We pass through `request` so `filterFilesByAccess` reads the (absent)
    // session and applies the anonymous-user rules. We DON'T forward the
    // original headers because some browser-supplied cookies could carry
    // session state we don't want sitemap rendering to depend on.
    const anonymousRequest = new Request(request.url, {
      method: "GET",
      headers: new Headers(),
    });

    if (sitemapType === "profiles") {
      const profiles = await fetchPublicProfilesForSitemap(MAX_PROFILE_URLS);
      if (profiles === null) return errorResponse();

      const profileUrls = profiles.map((profile: { username: string; created_at: string }) => ({
        loc: `${BASE_URL}/profile/${encodeURIComponent(profile.username)}`,
        lastmod: formatDate(profile.created_at),
        changefreq: "weekly" as const,
        priority: "0.8",
      }));

      return xmlResponse(generateSitemapXML(profileUrls));
    }

    if (sitemapType === "files") {
      const files = await fetchPublicFilesForSitemap(MAX_FILE_URLS);
      if (files === null) return errorResponse();

      // Defence-in-depth: even though the DB query already excludes
      // private/adult/draft/reel rows, run the canonical filter so any
      // future schema drift can't leak content into search engines.
      const safeFiles = await filterFilesByAccess(
        anonymousRequest,
        files as unknown as any[],
      );

      const fileUrls = safeFiles.map((file: any) => ({
        loc: `${BASE_URL}/${encodeURIComponent(String(file.unique_id ?? ""))}`,
        lastmod: formatDate(file.created_at),
        changefreq: "weekly" as const,
        priority: "0.7",
      }));

      return xmlResponse(generateSitemapXML(fileUrls));
    }

    if (sitemapType === "index") {
      const now = formatDate(new Date());
      const sitemaps = [
        { loc: `${BASE_URL}/api/sitemap?type=main`, lastmod: now },
        { loc: `${BASE_URL}/api/sitemap?type=profiles`, lastmod: now },
        { loc: `${BASE_URL}/api/sitemap?type=files`, lastmod: now },
      ];
      return xmlResponse(generateSitemapIndex(sitemaps));
    }

    if (sitemapType === "main") {
      const staticUrls = STATIC_PAGES.map((page) => ({
        loc: `${BASE_URL}${page.path ? `/${page.path}` : ""}`,
        lastmod: formatDate(new Date()),
        changefreq: page.changefreq as "daily" | "weekly" | "monthly",
        priority: page.priority,
      }));

      // The "main" sitemap is a small landing index for the freshest
      // content. Cap aggressively (500 each) so the cold-hit cost stays
      // tiny  the full lists live in the dedicated `profiles` / `files`
      // sub-sitemaps.
      const [recentProfiles, feedFiles] = await Promise.all([
        fetchPublicProfilesForSitemap(MAIN_SITEMAP_RECENT_LIMIT),
        fetchPublicFilesForSitemap(MAIN_SITEMAP_RECENT_LIMIT),
      ]);

      const recentFiles = feedFiles === null
        ? []
        : await filterFilesByAccess(
            anonymousRequest,
            feedFiles as unknown as any[],
          );

      const profileUrls = (recentProfiles ?? []).map(
        (profile: { username: string; created_at: string }) => ({
          loc: `${BASE_URL}/profile/${encodeURIComponent(profile.username)}`,
          lastmod: formatDate(profile.created_at),
          changefreq: "weekly" as const,
          priority: "0.8",
        }),
      );

      const fileUrls = (recentFiles ?? []).map((file: any) => ({
        loc: `${BASE_URL}/${encodeURIComponent(String(file.unique_id ?? ""))}`,
        lastmod: formatDate(file.created_at),
        changefreq: "weekly" as const,
        priority: "0.7",
      }));

      return xmlResponse(
        generateSitemapXML([...staticUrls, ...profileUrls, ...fileUrls]),
      );
    }

    // Unreachable thanks to VALID_TYPES, but keep the explicit fallthrough
    // so future additions don't silently 200.
    return errorResponse(400);
  } catch {
    return errorResponse();
  }
};
