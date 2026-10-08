import { useCallback, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import { toast } from "~/components/ui/sonner";
import { isValidUUID } from "~/lib/Security/inputValidation";
import { playbackPositionField } from "~/lib/playback/positionRegistry";

/**
 * Private saves, Instagram style: one tap keeps a video in your Saved list,
 * which nobody else can see. One store for the whole app, so every card and
 * button showing the same video agrees the moment any of them changes.
 */

const saved = new Set<string>();
/** Ids whose saved state is already known, so they are never asked about again. */
const known = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Record what a list response already told us: every id in `ids` is known,
 * and the ones in `savedIds` are saved. Saves a request per card.
 */
export function rememberSaves(ids: Iterable<string>, savedIds: Iterable<string> = []) {
  for (const id of ids) known.add(id);
  let changed = false;
  for (const id of savedIds) {
    known.add(id);
    if (!saved.has(id)) {
      saved.add(id);
      changed = true;
    }
  }
  if (changed) emit();
}

function setSaved(fileId: string, value: boolean) {
  known.add(fileId);
  if (value === saved.has(fileId)) return;
  if (value) saved.add(fileId);
  else saved.delete(fileId);
  emit();
}

async function loadStatus(fileId: string) {
  if (known.has(fileId) || !isValidUUID(fileId)) return;
  known.add(fileId);
  try {
    const res = await fetch(`/api/saves?fileId=${encodeURIComponent(fileId)}`, { credentials: "include" });
    if (!res.ok) {
      known.delete(fileId);
      return;
    }
    const json = await res.json();
    setSaved(fileId, json?.saved === true);
  } catch {
    known.delete(fileId);
  }
}

export function useSave(fileId: string, currentUserId?: string | null) {
  const navigate = useNavigate();
  const isSaved = useSyncExternalStore(
    subscribe,
    () => saved.has(fileId),
    () => false,
  );
  const [busy, setBusy] = useState(false);

  /** Ask the server once, the first time a menu or button for this video shows. */
  const ensureStatus = useCallback(() => {
    if (currentUserId) void loadStatus(fileId);
  }, [currentUserId, fileId]);

  const toggle = useCallback(async () => {
    if (!currentUserId) {
      const next = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/";
      navigate(`/auth/login?redirect=${encodeURIComponent(next)}`);
      return;
    }
    if (busy || !isValidUUID(fileId)) return;
    const wasSaved = saved.has(fileId);
    setSaved(fileId, !wasSaved);
    setBusy(true);
    try {
      const res = await fetch("/api/saves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ fileId, ...playbackPositionField(fileId) }),
      });
      const json = res.ok ? await res.json() : null;
      if (!json?.success) throw new Error("save failed");
      setSaved(fileId, json.saved === true);
      if (json.saved) {
        toast.success("Saved", {
          description: "Only you can see what you save.",
          action: { label: "View", onClick: () => navigate("/saved") },
        });
      } else {
        toast("Removed from Saved");
      }
    } catch {
      setSaved(fileId, wasSaved);
      toast.error("Couldn't update Saved. Try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, currentUserId, fileId, navigate]);

  return { saved: isSaved, busy, toggle, ensureStatus };
}
