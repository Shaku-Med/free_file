import { useEffect, useState } from "react";
import {
  getCachedPlaybackUrl,
  setCachedPlaybackUrl,
  subscribePlaybackUrlRefresh,
} from "~/lib/playbackUrlCache";

type MintState = { forFileId: string; url: string | null };

/**
 * Fetches a signed LoadPlay URL from POST /api/play/mint when the given
 * file is HLS-shaped. URLs are cached in-memory per fileId so watch ↔ mini
 * handoffs reuse the same ?t= token and Hls.js never reloads the manifest.
 *
 * Returns null while the fileId changes until a URL for *that* file is ready 
 * never leaks the previous file's minted URL across watch→watch navigation.
 */
export function usePlaybackUrl(file: {
  unique_id?: string | null;
  endpoint?: string | null;
  file_type?: string | null;
} | null | undefined): string | null {
  const fileId = file?.unique_id ?? null;
  const fileType = file?.file_type ?? null;
  const endpoint = file?.endpoint ?? null;

  const [mintState, setMintState] = useState<MintState | null>(() => {
    if (!fileId) return null;
    const cached = getCachedPlaybackUrl(fileId);
    return cached ? { forFileId: fileId, url: cached } : null;
  });
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!fileId) return;
    return subscribePlaybackUrlRefresh(fileId, () => {
      setRefreshTick((t) => t + 1);
    });
  }, [fileId]);

  useEffect(() => {
    const isHls =
      fileType === "application/vnd.apple.mpegurl" ||
      (typeof endpoint === "string" && endpoint.includes(".m3u8"));
    if (!fileId || !isHls) {
      setMintState(null);
      return;
    }

    const cached = getCachedPlaybackUrl(fileId);
    if (cached) {
      setMintState({ forFileId: fileId, url: cached });
      return;
    }

    setMintState({ forFileId: fileId, url: null });

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
        setMintState({ forFileId: fileId, url: next });
      })
      .catch(() => {
        if (!cancelled) setMintState({ forFileId: fileId, url: null });
      });

    return () => {
      cancelled = true;
    };
  }, [fileId, fileType, endpoint, refreshTick]);

  if (!fileId) return null;
  if (mintState?.forFileId === fileId) {
    return mintState.url ?? getCachedPlaybackUrl(fileId);
  }
  return getCachedPlaybackUrl(fileId);
}
