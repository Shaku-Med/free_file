// Short-lived load-scoped tokens so browser JS never sees the full c_user session JWT.
// Sent to LoadNodeServer as `Authorization: Bearer <token>` for adult/private media.

import { getCookie } from "~/lib/Security/Token";
import { EncryptCombine, DecryptCombine } from "~/lib/Security/unsharedkeyEncryption/Combined/Combined";
import { getAllKeys } from "~/lib/Security/unsharedkeyEncryption/Combined/Verification/TokenKeys";

const SESSION_KEY_NAMES = ["token1", "c_user"] as const;
const LOAD_KEY_NAMES = ["video_token", "token1"] as const;

export const LOAD_TOKEN_TTL_SECONDS = 60 * 60; // 1h

export type LoadTokenPayload = {
  typ: "load";
  c_usr: string;
  uid: string;
};

export async function mintLoadToken(input: {
  c_usr: string;
  userId: string;
}): Promise<string | null> {
  const keys = await getAllKeys([...LOAD_KEY_NAMES]);
  if (!keys) return null;

  const payload: LoadTokenPayload = {
    typ: "load",
    c_usr: input.c_usr,
    uid: input.userId,
  };

  return EncryptCombine(payload, keys, {
    expiresIn: LOAD_TOKEN_TTL_SECONDS,
    algorithm: "HS512",
  });
}

export async function verifyLoadToken(
  token: string,
): Promise<LoadTokenPayload | null> {
  if (!token) return null;
  const keys = await getAllKeys([...LOAD_KEY_NAMES]);
  if (!keys) return null;

  const decoded = await DecryptCombine(token, keys);
  if (!decoded || typeof decoded !== "object") return null;
  if (decoded.typ !== "load") return null;
  if (typeof decoded.c_usr !== "string" || !decoded.c_usr) return null;
  if (typeof decoded.uid !== "string" || !decoded.uid) return null;

  return {
    typ: "load",
    c_usr: decoded.c_usr,
    uid: decoded.uid,
  };
}

/** Mint a LoadNode bearer from the HttpOnly session cookie. */
export async function mintLoadBearerForRequest(
  request: Request,
  userId: string,
): Promise<string | null> {
  const c_user = getCookie("c_user", request.headers);
  if (!c_user) return null;

  const keys = await getAllKeys([...SESSION_KEY_NAMES]);
  if (!keys) return null;

  const decoded = await DecryptCombine(c_user, keys);
  if (!decoded || typeof decoded !== "object" || typeof decoded.c_usr !== "string") {
    return null;
  }

  return mintLoadToken({
    c_usr: decoded.c_usr,
    userId,
  });
}
