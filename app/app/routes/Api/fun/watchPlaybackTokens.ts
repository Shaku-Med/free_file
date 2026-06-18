import { createHmac, randomBytes, timingSafeEqual } from "crypto";



import { isValidUUID } from "~/lib/Security/inputValidation";

import { sessionScope } from "~/lib/Services/SegmentTokenService";

import { requireSecret } from "~/lib/Security/secretEnv.server";



/**

 * Playback watch-time chain tokens: **server-only HMAC**, same primitive as `_st` segment tokens.

 * Payload cannot be forged without `WATCH_PLAYBACK_TOKEN_SECRET` (or SEGMENT_* fallback).

 *

 * Bound to `{ userId, fileId, exp, nonce, sessionScope(headers) }`; random UUID guesses never verify.

 *

 * Replay: each `nonce` is accepted at most once until pruned from memory (no DB).

 */

export const WATCH_PLAYBACK_TOKEN_TTL_MS = 3 * 60 * 1000;



const TOKEN_SCHEME = "v2";

const NONCE_BYTES = 18;

const MAX_TOKEN_CHARS = 600;



const NONCE_HOLD_SLACK_MS = 2 * 60 * 1000;

const MAX_NONCES = 55_000;



const consumedNonces = new Map<string, number>();



/** Last accepted cumulative watch seconds per viewer+asset (tamper guard). */

type ProgressEntry = { watch: number; atMs: number };

const MAX_PROGRESS_TRACKED = 8_000;

const playbackProgress = new Map<string, ProgressEntry>();



function getPlaybackSecret(): string {

  // Fail closed: never sign/verify playback tokens with an empty key.
  return requireSecret(
    "WATCH_PLAYBACK_TOKEN_SECRET",
    process.env.WATCH_PLAYBACK_TOKEN_SECRET,
    process.env.SEGMENT_TOKEN_SECRET,
    process.env.HLS_MANIFEST_GATE_SECRET,
    process.env.VAPID_PRIVATE_KEY,
  );

}



function pruneConsumedNonces() {

  const now = Date.now();

  for (const [k, until] of consumedNonces) {

    if (until <= now) consumedNonces.delete(k);

  }

  while (consumedNonces.size > MAX_NONCES) {

    const first = consumedNonces.keys().next().value;

    if (first === undefined) break;

    consumedNonces.delete(first);

  }

}



function tryConsumeNonceOnce(nonce: string, expSecs: number): boolean {

  pruneConsumedNonces();

  if (consumedNonces.has(nonce)) return false;

  const until =

    Math.max(Date.now(), expSecs * 1000) + NONCE_HOLD_SLACK_MS;

  consumedNonces.set(nonce, until);

  return true;

}



function progressKey(userId: string, fileId: string) {

  return `${userId}:${fileId}`;

}



/** Prunes playback progress LRU-style and consumed-nonces TTL map. */

export function pruneWatchPlaybackTokens() {

  pruneConsumedNonces();

  while (playbackProgress.size > MAX_PROGRESS_TRACKED) {

    const first = playbackProgress.keys().next().value;

    if (first === undefined) break;

    playbackProgress.delete(first);

  }

}



function signPlayback(msg: string): string {

  return createHmac("sha256", getPlaybackSecret())

    .update(msg)

    .digest("base64url");

}



function buildSignedMessage(opts: {

  userId: string;

  fileId: string;

  exp: number;

  nonce: string;

  scope: string;

}): string {

  const { userId, fileId, exp, nonce, scope } = opts;

  return `${userId}|${fileId}|${exp}|${nonce}|${scope}|${TOKEN_SCHEME}`;

}



function encodeSubject(userId: string, fileId: string): string {

  return Buffer.from(`${userId}|${fileId}`, "utf8").toString("base64url");

}



function decodeSubject(b64payload: string): { userId: string; fileId: string } | null {

  let plain: string;

  try {

    plain = Buffer.from(b64payload, "base64url").toString("utf8");

  } catch {

    return null;

  }

  if (plain.length === 0 || plain.length > 120) return null;

  const i = plain.indexOf("|");

  if (i <= 0 || i === plain.length - 1) return null;

  const userId = plain.slice(0, i);

  const fileId = plain.slice(i + 1);

  if (

    plain.indexOf("|", i + 1) !== -1 ||

    !isValidUUID(userId) ||

    !isValidUUID(fileId)

  ) {

    return null;

  }

  return { userId, fileId };

}



export type WatchPlaybackConsumption = {

  userId: string;

  fileId: string;

};



/**

 * Stateless signed token (+ one-time nonce in memory).

 * Caller must mint with same `Headers` family as the client POST (cookie scope binding).

 */

export function mintWatchPlaybackToken(

  userId: string,

  fileId: string,

  headers: Headers,

): string {

  pruneWatchPlaybackTokens();

  const exp =

    Math.floor(Date.now() / 1000) +

    Math.max(120, Math.floor(WATCH_PLAYBACK_TOKEN_TTL_MS / 1000));

  const nonce = randomBytes(NONCE_BYTES).toString("base64url");

  const scope = sessionScope(headers);

  const msg = buildSignedMessage({ userId, fileId, exp, nonce, scope });

  const sig = signPlayback(msg);

  const subj = encodeSubject(userId, fileId);

  return `${sig}.${exp}.${nonce}.${subj}`;

}



/**

 * Verifies MAC + expiry + session scope match, binds `userId|fileId` from ciphertext payload.

 * Replay of the same ciphertext fails after first successful nonce consumption.

 */

export function consumeWatchPlaybackToken(

  raw: string | null | undefined,

  headers: Headers,

): WatchPlaybackConsumption | null {

  pruneWatchPlaybackTokens();

  const s = typeof raw === "string" ? raw.trim() : "";

  if (!s || s.length > MAX_TOKEN_CHARS) return null;



  const parts = s.split(".");

  if (parts.length !== 4) return null;



  const [sig, expStr, nonce, b64payload] = parts;

  const exp = parseInt(expStr, 10);

  if (

    !Number.isFinite(exp) ||

    exp !== Math.floor(exp) ||

    exp < Math.floor(Date.now() / 1000)

  ) {

    return null;

  }

  const subject = decodeSubject(b64payload);

  if (!subject) return null;

  if (

    nonce.length === 0 ||

    nonce.length > 64 ||

    sig.length === 0 ||

    sig.length > 64

  ) {

    return null;

  }



  const scope = sessionScope(headers);

  const expectedSig = signPlayback(

    buildSignedMessage({

      userId: subject.userId,

      fileId: subject.fileId,

      exp,

      nonce,

      scope,

    }),

  );



  if (sig.length !== expectedSig.length) return null;

  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {

    return null;

  }



  if (!tryConsumeNonceOnce(nonce, exp)) return null;



  return { userId: subject.userId, fileId: subject.fileId };

}



/** Clamp unrealistic jumps in cumulative `watch_duration_s` across heartbeats. */

export function sanitizeAcceptedWatchSeconds(

  userId: string,

  fileId: string,

  claimedSeconds: number,

): number {

  pruneWatchPlaybackTokens();

  const key = progressKey(userId, fileId);

  const now = Date.now();



  let prev = playbackProgress.get(key);

  if (!prev) prev = { watch: 0, atMs: now };



  let c = Number(claimedSeconds);

  if (!Number.isFinite(c) || c < 0) c = 0;

  if (c > 86_400) c = 86_400;



  /** Not moving forward — keep prior accepted cumulative (matches RPC `GREATEST` ceiling). */

  if (c <= prev.watch) {

    prev.atMs = now;

    playbackProgress.set(key, prev);

    return prev.watch;

  }



  const elapsedSec = Math.max(1, (now - prev.atMs) / 1000);

  const maxIncrease = Math.min(900, Math.floor(elapsedSec * 28) + 45);

  const admitted = Math.min(c, prev.watch + maxIncrease);

  playbackProgress.set(key, { watch: admitted, atMs: now });

  return admitted;

}

