import { EnvValidator } from "~/lib/EnvValidator";
import { isAuthenticated } from "~/lib/Security/Password";

/**
 * GIF search + trending via GIPHY API.
 * GIPHY image URLs are stable CDN links; we store url + id for comments.
 * Beta keys: 100 req/hr — we return trending by default and cache responses to reduce calls.
 */
const GIPHY_SEARCH = "https://api.giphy.com/v1/gifs/search";
const GIPHY_TRENDING = "https://api.giphy.com/v1/gifs/trending";

type GifResult = { id: string; url: string; previewUrl: string };

function mapGiphyToResults(data: {
  data?: Array<{
    id: string;
    images?: {
      original?: { url: string };
      fixed_height?: { url: string };
      fixed_height_small?: { url: string };
      downsized?: { url: string };
    };
  }>;
}): GifResult[] {
  return (data.data || [])
    .map((g) => {
      const img = g.images || {};
      const url = img.original?.url || img.fixed_height?.url || img.downsized?.url || "";
      const previewUrl = img.fixed_height_small?.url || img.fixed_height?.url || url;
      return { id: g.id, url: url || g.id, previewUrl: previewUrl || url || g.id };
    })
    .filter((r) => r.url);
}

export const loader = async ({ request }: { request: Request }) => {
  try {
    const user = await isAuthenticated(request, ["id"]);
    if (!user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized", results: [] }), {
        status: 401, headers: { "Content-Type": "application/json" },
      });
    }

    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim() || "";
    const trending = url.searchParams.get("trending") === "1";
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "20", 10), 1), 50);

    const giphyKey = EnvValidator("GIPHY_API_KEY");
    if (!giphyKey) {
      return new Response(
        JSON.stringify({
          error: "GIF search not configured. Set GIPHY_API_KEY in your environment.",
          results: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const useTrending = trending || !q;
    const endpoint = useTrending ? GIPHY_TRENDING : GIPHY_SEARCH;
    const params = new URLSearchParams({
      api_key: giphyKey,
      limit: String(limit),
      rating: "pg",
    });
    if (!useTrending) params.set("q", q);

    const res = await fetch(`${endpoint}?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });

    if (res.status === 429) {
      return new Response(
        JSON.stringify({
          error: "Too many requests. Please wait a minute and try again.",
          results: [],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=120",
          },
        }
      );
    }

    if (!res.ok) {
      const text = await res.text();
      console.error("GIPHY API error:", res.status, text);
      return new Response(
        JSON.stringify({ error: "GIF search failed", results: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = (await res.json()) as { data?: unknown[] };
    const results = mapGiphyToResults(data as Parameters<typeof mapGiphyToResults>[0]);

    const cacheMaxAge = useTrending ? 300 : 60;
    return new Response(JSON.stringify({ results, next: null }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${cacheMaxAge}`,
      },
    });
  } catch (error) {
    console.error("GIF search error:", error);
    return new Response(
      JSON.stringify({ error: "GIF search failed", results: [] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
};
