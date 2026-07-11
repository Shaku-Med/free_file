/**
 * Short-lived upload-scoped tokens.
 *
 * Never hand the long-lived `c_user` session JWT to browser JS. Mint a
 * separate token (different key material + `typ: "upload"`) with a short TTL
 * so XSS / leaked bearer tokens cannot become full account sessions.
 */

import { EncryptCombine, DecryptCombine } from "~/lib/Security/unsharedkeyEncryption/Combined/Combined";
import { getAllKeys } from "~/lib/Security/unsharedkeyEncryption/Combined/Verification/TokenKeys";

/** Upload bearer lifetime — long enough for chunked uploads, short enough to limit blast radius. */
export const UPLOAD_TOKEN_TTL_SECONDS = 15 * 60;

const UPLOAD_KEY_NAMES = ["file_token", "temp_token"] as const;

export type UploadTokenPayload = {
  typ: "upload";
  c_usr: string;
  uid: string;
};

export async function mintUploadToken(input: {
  c_usr: string;
  userId: string;
}): Promise<string | null> {
  const keys = await getAllKeys([...UPLOAD_KEY_NAMES]);
  if (!keys) return null;

  const payload: UploadTokenPayload = {
    typ: "upload",
    c_usr: input.c_usr,
    uid: input.userId,
  };

  return EncryptCombine(payload, keys, {
    expiresIn: UPLOAD_TOKEN_TTL_SECONDS,
    algorithm: "HS512",
  });
}

export async function verifyUploadToken(
  token: string,
): Promise<UploadTokenPayload | null> {
  if (!token) return null;
  const keys = await getAllKeys([...UPLOAD_KEY_NAMES]);
  if (!keys) return null;

  const decoded = await DecryptCombine(token, keys);
  if (!decoded || typeof decoded !== "object") return null;
  if (decoded.typ !== "upload") return null;
  if (typeof decoded.c_usr !== "string" || !decoded.c_usr) return null;
  if (typeof decoded.uid !== "string" || !decoded.uid) return null;

  return {
    typ: "upload",
    c_usr: decoded.c_usr,
    uid: decoded.uid,
  };
}
