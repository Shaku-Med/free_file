import { useEffect, useState } from "react";

/**
 * usePlaybackUrl
 *
 * Fetches a signed LoadPlay URL from POST /api/play/mint when the given
 * file is HLS-shaped. The URL is bound server-side to the requester's
 * IP + UA, so it can't be reused off-device even if it leaks.
 *
 * The URL is never written to HTML or loader JSON — it only exists in
 * component state, which means view-source / scrapers can't lift it.
 *
 * Returns `null` until the mint resolves; callers should pass that
 * straight to `getVideoSrc(..., playbackUrl)` which falls back to the
 * legacy `/api/load/video/` proxy when the URL isn't ready yet.
 */
export function usePlaybackUrl(file: {
  unique_id?: string | null;
  endpoint?: string | null;
  file_type?: string | null;
} | null | undefined): string | null {
  const fileId = file?.unique_id ?? null;
  const fileType = file?.file_type ?? null;
  const endpoint = file?.endpoint ?? null;

  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const isHls =
      fileType === "application/vnd.apple.mpegurl" ||
      (typeof endpoint === "string" && endpoint.includes(".m3u8"));
    if (!fileId || !isHls) {
      setUrl(null);
      return;
    }

    let cancelled = false;
    setUrl(null);
    fetch("/api/play/mint", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "fetch",
      },
      body: JSON.stringify({ fileId }),
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const body = (await res.json().catch(() => null)) as { url?: string } | null;
        return body?.url ?? null;
      })
      .then((next) => {
        if (!cancelled) setUrl(next);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [fileId, fileType, endpoint]);

  return url;
}
