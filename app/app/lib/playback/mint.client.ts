/**
 * The one place the client mints a playback URL. When loadplay encrypts the
 * segments, the mint also returns this playback's proof secret, which the
 * key loader signs its key requests with. It's kept here in memory only,
 * keyed by the playback token, and never written anywhere.
 */

const MAX_PROOFS = 64;
const PROOF_RE = /^[A-Za-z0-9_-]{43}$/;
const proofs = new Map<string, string>();

function tokenOf(url: string): string | null {
  try {
    return new URL(url, window.location.href).searchParams.get("t");
  } catch {
    return null;
  }
}

/** Mints a playback URL for fileId, or null when the server says no. */
export async function mintPlayback(fileId: string): Promise<string | null> {
  const res = await fetch("/api/play/mint", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "fetch",
    },
    body: JSON.stringify({ fileId }),
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { url?: unknown; proof?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url : null;
  if (!url) return null;
  const token = tokenOf(url);
  if (token && typeof body?.proof === "string" && PROOF_RE.test(body.proof)) {
    proofs.delete(token);
    proofs.set(token, body.proof);
    while (proofs.size > MAX_PROOFS) {
      const oldest = proofs.keys().next().value;
      if (oldest === undefined) break;
      proofs.delete(oldest);
    }
  }
  return url;
}

/** The proof secret for the playback a loadplay URL belongs to. */
export function playbackProof(url: string): string | null {
  const token = tokenOf(url);
  return token ? proofs.get(token) ?? null : null;
}
