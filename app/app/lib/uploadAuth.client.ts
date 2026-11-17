export type UploadAuthContext = {
  bearer: string;
  base: string;
  /** When bearer was minted, in ms. freshUploadBearer renews from this. */
  mintedAt: number;
};

/**
 * =============================================================================
 * UPLOAD AUTH (GoUpload only) — preferred client entry for uploads
 * =============================================================================
 *
 * DO NOT add fallbacks to POST /api/upload. All uploads must go to GoUpload.
 *
 * See also: MediaSelectionModal.tsx (uploadToGo), GoUpload/main.go, .env
 * UPLOAD_SERVER_URL / GO_UPLOAD_URL.
 * =============================================================================
 *
 * Mints a short-lived upload-scoped bearer from the HttpOnly c_user cookie
 * (server-side). Never receives the session JWT itself.
 */

const OFFLINE = "Upload server is offline. Try again later.";

// Bearers live 15 minutes (UPLOAD_TOKEN_TTL_SECONDS). Renewing at 8 leaves the
// old one enough time to finish a slow chunk or a busy-server retry.
const BEARER_RENEW_AFTER_MS = 8 * 60 * 1000;

async function mintUploadBearer(): Promise<{ bearer: string; base: string }> {
  const authRes = await fetch("/api/upload/auth", {
    credentials: "include",
    headers: { "X-Requested-With": "fetch" },
  });
  if (authRes.status === 401) {
    throw new Error("Please log in to upload.");
  }
  if (authRes.status === 429) {
    throw new Error("Too many upload requests. Wait a minute and try again.");
  }
  if (!authRes.ok) {
    throw new Error(OFFLINE);
  }

  const json = (await authRes.json()) as {
    bearer?: string;
    upload_server_url?: string;
  };
  const bearer = json.bearer?.trim();
  const base = json.upload_server_url?.replace(/\/$/, "") ?? "";
  if (!bearer || !base) {
    throw new Error(OFFLINE);
  }
  return { bearer, base };
}

export async function fetchUploadAuthContext(): Promise<UploadAuthContext> {
  const { bearer, base } = await mintUploadBearer();

  try {
    const health = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!health.ok) {
      throw new Error(OFFLINE);
    }
  } catch {
    throw new Error(OFFLINE);
  }

  return { bearer, base, mintedAt: Date.now() };
}

const renewing = new WeakMap<UploadAuthContext, Promise<string>>();

/**
 * A bearer with time left on it. Big files and long batches outlive a single
 * bearer, so this mints the next one before it runs out. Minting still needs
 * the HttpOnly login cookie, so signing out or a restricted account stops an
 * upload at its next request. force renews now, for a request the server
 * already refused as expired.
 */
export function freshUploadBearer(ctx: UploadAuthContext, force = false): Promise<string> {
  if (!force && Date.now() - ctx.mintedAt < BEARER_RENEW_AFTER_MS) {
    return Promise.resolve(ctx.bearer);
  }
  let pending = renewing.get(ctx);
  if (!pending) {
    pending = mintUploadBearer().then(
      ({ bearer }) => {
        ctx.bearer = bearer;
        ctx.mintedAt = Date.now();
        return bearer;
      },
      (e: unknown) => {
        if (e instanceof Error && e.message === "Please log in to upload.") {
          throw new Error("Your login expired. Log in again, then retry this upload.");
        }
        throw e;
      },
    );
    renewing.set(ctx, pending);
    const clear = () => renewing.delete(ctx);
    pending.then(clear, clear);
  }
  return pending;
}

/**
 * Sends with a bearer that still has time left. If the server calls it expired
 * anyway (a slow request, a laptop that slept) this renews once and resends;
 * GoUpload refuses a bad bearer before its handler runs, so nothing doubles.
 */
export async function sendWithUploadAuth(
  ctx: UploadAuthContext,
  send: (bearer: string) => Promise<Response>,
): Promise<Response> {
  const res = await send(await freshUploadBearer(ctx));
  if (res.status !== 401) return res;
  return send(await freshUploadBearer(ctx, true));
}

// Long enough to ride out an upload server restart.
const DROPPED_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

/**
 * Resends after a dropped connection or a gateway error. Only for requests the
 * server can safely see twice, like a chunk: it answers one it already has
 * without writing it again.
 */
export async function retryDroppedRequest(
  send: () => Promise<Response>,
  onRetry: () => void,
  delaysMs: readonly number[] = DROPPED_RETRY_DELAYS_MS,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= delaysMs.length;
    let res: Response | null = null;
    try {
      res = await send();
    } catch (e) {
      // fetch only throws a TypeError when the request never got an answer.
      if (!(e instanceof TypeError)) throw e;
      if (last) throw new Error("Connection lost during upload. Check your internet and try again.");
    }
    if (res && (last || (res.status !== 502 && res.status !== 504))) return res;
    onRetry();
    await new Promise((r) => setTimeout(r, delaysMs[attempt]));
  }
}
