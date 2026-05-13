/**
 * Profile/liked/history RPC rows may omit `is_reel`, use 0/1, or expose alternate column
 * names. This keeps `groupConsecutiveReelClusters` and `fileWatchPath` consistent with the
 * main feed.
 */

function parseMetadataObject(meta: unknown): Record<string, unknown> | null {
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    return meta as Record<string, unknown>;
  }
  if (typeof meta === "string") {
    try {
      const p = JSON.parse(meta);
      if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Portrait framing is a strong signal for short form / reel style when flags are missing. */
/** Portrait framing from dedicated columns when metadata blob is absent. */
function inferReelFromDimensionColumns(r: Record<string, unknown>): boolean {
  const w = Number(
    r["video_width"] ?? r["display_width"] ?? r["file_width"] ?? r["width"]
  );
  const h = Number(
    r["video_height"] ?? r["display_height"] ?? r["file_height"] ?? r["height"]
  );
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h / w >= 1.2;
}

function inferReelFromPortraitDimensions(r: Record<string, unknown>): boolean {
  const meta = parseMetadataObject(r["metadata"]);
  if (meta) {
    const w = Number(meta.width ?? meta.video_width ?? meta.w ?? meta.display_width);
    const h = Number(meta.height ?? meta.video_height ?? meta.h ?? meta.display_height);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h / w >= 1.2) return true;
  }
  return inferReelFromDimensionColumns(r);
}

export function normalizeRpcFileRow<T extends Record<string, unknown>>(r: T): T {
  const t = (v: unknown) =>
    v === true || v === 1 || v === "1" || v === "true";

  const looksReel =
    t(r["is_reel"]) ||
    t(r["f_is_reel"]) ||
    t(r["f_short"]) ||
    t(r["is_short"]) ||
    t(r["is_short_video"]) ||
    t(r["is_short_form"]);

  let is_reel: boolean | undefined;
  if (looksReel) is_reel = true;
  else if (r["is_reel"] === false || r["is_reel"] === 0) is_reel = false;
  else if (r["f_is_reel"] === false || r["f_is_reel"] === 0) is_reel = false;

  if (is_reel === undefined && inferReelFromPortraitDimensions(r)) {
    is_reel = true;
  }

  let feed_reel_cluster_id: number | null | undefined;
  const rawCid = r["feed_reel_cluster_id"] ?? r["f_feed_reel_cluster_id"];
  if (rawCid != null && rawCid !== "") {
    const n = Number(rawCid);
    feed_reel_cluster_id = Number.isFinite(n) ? n : null;
  }

  return {
    ...r,
    ...(is_reel !== undefined ? { is_reel } : {}),
    ...(feed_reel_cluster_id !== undefined ? { feed_reel_cluster_id } : {}),
  };
}
