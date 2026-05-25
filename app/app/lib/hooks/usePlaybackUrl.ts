import { useEffect, useState } from "react";
import {
  getCachedPlaybackUrl,
  setCachedPlaybackUrl,
} from "~/lib/playbackUrlCache";

/**
 * Fetches a signed LoadPlay URL from POST /api/play/mint when the given
 * file is HLS-shaped. URLs are cached in-memory per fileId so watch ↔ mini
 * handoffs reuse the same ?t= token and Hls.js never reloads the manifest.
 */
export function usePlaybackUrl(file: {
  unique_id?: string | null;
  endpoint?: string | null;
  file_type?: string | null;
} | null | undefined): string | null {
  const fileId = file?.unique_id ?? null;
  const fileType = file?.file_type ?? null;
  const endpoint = file?.endpoint ?? null;

  const [url, setUrl] = useState<string | null>(() =>
    fileId ? getCachedPlaybackUrl(fileId) : null,
  );

  useEffect(() => {
    const isHls =
      fileType === "application/vnd.apple.mpegurl" ||
      (typeof endpoint === "string" && endpoint.includes(".m3u8"));
    if (!fileId || !isHls) {
      setUrl(null);
      return;
    }

    const cached = getCachedPlaybackUrl(fileId);
    if (cached) {
      setUrl(cached);
      return;
    }

    let cancelled = false;
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
        if (cancelled || !next) return;
        setCachedPlaybackUrl(fileId, next);
        setUrl(next);
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
