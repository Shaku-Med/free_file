import { useEffect, useRef, useState } from "react";
import type { MixCardData } from "~/components/MixCard";
import type { FileType } from "~/lib/types";

/**
 * Fetches ONE mix to inject into the feed, seeded from a music track the
 * viewer is already being shown.
 *
 * Seeding from the current feed (rather than a global "top track") keeps the
 * mix contextually relevant — it reads as "because you're seeing this" — while
 * the API's own taste profile personalises the ordering inside it.
 *
 * Deliberately client-side: the feed endpoint stays untouched, so a failure
 * here degrades to "no mix card" instead of breaking the feed.
 */
export function useFeedMix(files: FileType[], enabled = true): MixCardData | null {
  const [mix, setMix] = useState<MixCardData | null>(null);
  /** Seed we've already resolved, so re-renders don't refetch. */
  const seededRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const seedFile = files.find(
      (f) => (f as { is_music?: boolean }).is_music === true && f.unique_id,
    );
    const seed = seedFile?.unique_id ? String(seedFile.unique_id) : null;
    if (!seed || seededRef.current === seed) return;
    seededRef.current = seed;

    let cancelled = false;
    const controller = new AbortController();

    fetch(`/api/music/mix?seed=${encodeURIComponent(seed)}&limit=1`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body?.gid) return;
        const first = Array.isArray(body.items) ? body.items[0] : null;
        // A mix with nothing to play is worse than no mix at all.
        if (!first?.unique_id) return;
        setMix({
          gid: String(body.gid),
          firstItem: first as FileType,
          count: Number(body.total) || undefined,
        });
      })
      .catch(() => {
        /* offline / aborted — feed simply shows no mix */
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [files, enabled]);

  return mix;
}
