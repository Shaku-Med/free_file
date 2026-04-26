/** Client: exchange root bootstrap for a one-shot `_mk` manifest key. */

export function manifestPathFromVideoApiUrl(src: string): string | null {
  const i = src.indexOf("/api/load/video/");
  if (i === -1) return null;
  const rest = src.slice(i + "/api/load/video/".length);
  const path = rest.split("?")[0]?.split("#")[0];
  return path || null;
}

export function stripMkSearchParam(href: string): string {
  try {
    const u = new URL(href, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    u.searchParams.delete("_mk");
    const q = u.searchParams.toString();
    return `${u.pathname}${q ? `?${q}` : ""}${u.hash}`;
  } catch {
    return href
      .replace(/([?&])_mk=[^&]*&?/g, "$1")
      .replace(/[?&]$/, "");
  }
}

export async function exchangeHlsManifestKey(
  src: string,
  bootstrap: string | null | undefined,
  bootstrapRetry: string | null | undefined
): Promise<string | null> {
  const manifestPath = manifestPathFromVideoApiUrl(src);
  if (!manifestPath || !bootstrap) return null;

  const post = async (b: string) => {
    const res = await fetch("/api/load/hls-manifest-session", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bootstrap: b, manifestPath }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { manifestKey?: string };
    const mk = data?.manifestKey;
    if (typeof mk !== "string" || !mk) return null;
    const u = new URL(
      src,
      typeof window !== "undefined" ? window.location.origin : "http://localhost"
    );
    u.searchParams.set("_mk", mk);
    return `${u.pathname}${u.search}${u.hash}`;
  };

  let out = await post(bootstrap);
  if (out) return out;
  if (bootstrapRetry) out = await post(bootstrapRetry);
  return out;
}
