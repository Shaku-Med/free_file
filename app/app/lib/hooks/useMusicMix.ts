import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import type { FileType } from "~/lib/types";

/**
 * YouTube-style Mix ("radio") — it's just THERE, no button. While watching a
 * track the up-next becomes an auto-generated station seeded from it. The URL
 * carries `?list=RD<seedUniqueId>&index=N` so the station stays stable as you
 * move through it and is shareable, but the user never has to start it:
 *
 *  - Fresh track (no `list`)  → seed = the current track (auto-radio).
 *  - Inside a station (`list`) → seed stays the ORIGINAL seed; index advances.
 *
 * Nothing is stored — the queue is regenerated from the seed via
 * `/api/music-mix`, with a stable per-seed shuffle so the order is reproducible.
 * This is the auto "Mix", distinct from the user's manual play queue.
 */

const MIX_PREFIX = "RD";

/** Session cache so navigating track→track inside one station doesn't refetch. */
const mixCache = new Map<string, { title: string; videos: FileType[] }>();

export interface MusicMix {
  /** True once we have a seed (≈ always on a watch page). */
  active: boolean;
  /** Seed track's public unique id the station is built from. */
  seedUnique: string | null;
  /** `list` value to thread into navigation (existing one or a fresh RD<seed>). */
  listId: string | null;
  /** 0-based position the URL points at (resume / display). */
  index: number;
  /** Ordered mix queue (seed excluded — it plays as the page's own video). */
  videos: FileType[];
  /** Auto title, e.g. "Mix - Nathyrra - North Star". */
  title: string;
  loading: boolean;
  /** Href to play `uniqueId` while staying in this station. */
  buildHref: (uniqueId: string) => string;
}

function parseListSeed(listValue: string | null): string | null {
  if (!listValue || !listValue.startsWith(MIX_PREFIX)) return null;
  const seed = listValue.slice(MIX_PREFIX.length).trim();
  return seed.length > 0 ? seed : null;
}

/**
 * @param currentUniqueId the watch page's current track id — used to auto-seed
 *   the station when the URL doesn't already carry a `list=RD…`.
 */
export function useMusicMix(currentUniqueId?: string): MusicMix {
  const [searchParams, setSearchParams] = useSearchParams();
  const listId = searchParams.get("list");
  const parsedSeed = parseListSeed(listId);

  // Auto-radio: no explicit station in the URL → seed from the current track.
  const seedUnique = parsedSeed ?? (currentUniqueId || null);
  // What we thread into hops: the live station id, or a fresh one for auto mode.
  const effectiveListId = listId ?? (seedUnique ? `${MIX_PREFIX}${seedUnique}` : null);

  const indexParam = parseInt(searchParams.get("index") ?? "", 10);
  const index = Number.isFinite(indexParam) && indexParam >= 0 ? indexParam : 0;

  const [videos, setVideos] = useState<FileType[]>(() =>
    seedUnique ? mixCache.get(seedUnique)?.videos ?? [] : [],
  );
  const [title, setTitle] = useState<string>(() =>
    seedUnique ? mixCache.get(seedUnique)?.title ?? "" : "",
  );
  const [loading, setLoading] = useState(false);
  const lastSeedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!seedUnique) {
      setVideos([]);
      setTitle("");
      return;
    }
    if (lastSeedRef.current === seedUnique) return;
    lastSeedRef.current = seedUnique;

    const cached = mixCache.get(seedUnique);
    if (cached) {
      setVideos(cached.videos);
      setTitle(cached.title);
      return;
    }

    let cancelled = false;
    setLoading(true);
    // Stable shuffle token derived from the seed → reproducible base order.
    const shuffle = `mix-${seedUnique}`;
    fetch(
      `/api/music-mix?seed_unique=${encodeURIComponent(seedUnique)}&seed=${encodeURIComponent(shuffle)}`,
      { credentials: "include", headers: { Accept: "application/json" } },
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const list: FileType[] = Array.isArray(data?.data) ? data.data : [];
        const mixName: string = typeof data?.title === "string" ? data.title : "";
        mixCache.set(seedUnique, { title: mixName, videos: list });
        setVideos(list);
        setTitle(mixName);
      })
      .catch(() => {
        if (!cancelled) {
          setVideos([]);
          setTitle("");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [seedUnique]);

  // Reflect the auto-radio in the URL — YouTube-style — the moment it actually
  // has tracks: `?list=RD<current>&index=0`. Done only once per track and only
  // when a mix exists, so non-music clips don't get a junk `list=` param.
  const reflectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (parsedSeed || !currentUniqueId) return; // already a station / no track
    if (videos.length === 0) return; // nothing to reflect yet
    if (reflectedRef.current === currentUniqueId) return;
    reflectedRef.current = currentUniqueId;
    const next = new URLSearchParams(searchParams);
    next.set("list", `${MIX_PREFIX}${currentUniqueId}`);
    if (!next.has("index")) next.set("index", "0");
    setSearchParams(next, { replace: true });
  }, [parsedSeed, currentUniqueId, videos.length, searchParams, setSearchParams]);

  return useMemo<MusicMix>(
    () => ({
      active: Boolean(seedUnique),
      seedUnique,
      listId: effectiveListId,
      index,
      videos,
      title,
      loading,
      buildHref: (uniqueId: string) => {
        const base = `/${encodeURIComponent(uniqueId)}`;
        if (!effectiveListId) return base;
        const pos = videos.findIndex((v) => v.unique_id === uniqueId);
        const idx = pos >= 0 ? pos + 1 : 0; // station = [seed, ...videos]
        return `${base}?list=${encodeURIComponent(effectiveListId)}&index=${idx}`;
      },
    }),
    [seedUnique, effectiveListId, index, videos, title, loading],
  );
}
