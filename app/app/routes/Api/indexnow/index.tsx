import { BASE_URL } from "~/lib/URLS";

const INDEXNOW_KEY = "memories-indexnow-key";
const KEY_LOCATION = `${BASE_URL}/memories-indexnow-key.txt`;
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const authHeader = request.headers.get("Authorization");
  const secret = authHeader?.replace(/^Bearer\s+/i, "").trim();
  const expected = typeof process !== "undefined" ? process.env.INDEXNOW_SECRET : "";
  if (expected && secret !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const host = new URL(BASE_URL).host;
    const sitemapUrl = `${BASE_URL}/api/sitemap?type=index`;
    const body = {
      host,
      key: INDEXNOW_KEY,
      keyLocation: KEY_LOCATION,
      urlList: [sitemapUrl, BASE_URL, `${BASE_URL}/search`],
    };

    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: "IndexNow submit failed", status: res.status, body: text }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: "IndexNow submission sent" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("IndexNow error:", e);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
