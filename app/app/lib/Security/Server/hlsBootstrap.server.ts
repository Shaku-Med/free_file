import { randomBytes } from "crypto";
import {
  EncryptCombine,
  DecryptCombine,
} from "~/lib/Security/unsharedkeyEncryption/Combined/Combined";
import { getClientIP } from "~/lib/Security/unsharedkeyEncryption/Combined/Verification/GetIp";
import {
  buildKeyNames,
  extractTokenHeaders,
  getAllKeys,
} from "~/lib/Security/unsharedkeyEncryption/Combined/Verification/TokenKeys";
import { getExpirationDate } from "~/lib/Security/unsharedkeyEncryption/Combined/Verification/ExpirationTime";

export type HlsPlaybackKind = "guest" | "user";

/**
 * Guest bootstrap chains authorization_key + token1; signed-in uses authorization_key + token2.
 * Payload is bound to the same client fingerprint headers as other app tokens.
 */
export async function issueHlsBootstrap(
  headers: Headers,
  kind: HlsPlaybackKind,
  userId: string | null
): Promise<string | null> {
  try {
    const gip = await getClientIP(headers);
    if (!gip) return null;
    const extra = kind === "guest" ? (["token1"] as const) : (["token2"] as const);
    const keyNames = buildKeyNames([...extra]);
    const encryptionKeys = await getAllKeys(keyNames);
    if (!encryptionKeys) return null;

    const expirationDate = getExpirationDate("2h");
    const obj: Record<string, unknown> = {
      ip: gip,
      "sec-ch-ua-platform": headers.get("sec-ch-ua-platform"),
      "user-agent": headers.get("user-agent")?.replace(/\s+/g, "") ?? "",
      "x-forwarded-for": gip,
      expiresAt: expirationDate.toISOString(),
      typ: "hls_bootstrap",
      playbackKind: kind,
      userId: kind === "user" ? userId : null,
      nonce: randomBytes(16).toString("hex"),
    };

    return await EncryptCombine(obj, encryptionKeys, {
      algorithm: "HS512",
      expiresIn: "2h",
    });
  } catch (e) {
    console.error("issueHlsBootstrap:", e);
    return null;
  }
}

export async function verifyHlsBootstrap(
  token: string,
  headers: Headers,
  kind: HlsPlaybackKind,
  userId: string | null
): Promise<boolean> {
  try {
    const extra = kind === "guest" ? (["token1"] as const) : (["token2"] as const);
    const keyNames = buildKeyNames([...extra]);
    const encryptionKeys = await getAllKeys(keyNames);
    if (!encryptionKeys) return false;

    const decrypted = await DecryptCombine(token, encryptionKeys);
    if (!decrypted || typeof decrypted !== "object") return false;

    const d = decrypted as Record<string, unknown>;
    if (d.typ !== "hls_bootstrap" || d.playbackKind !== kind) return false;
    if (kind === "user") {
      if (!userId || d.userId !== userId) return false;
    } else if (d.userId != null) {
      return false;
    }
    if (d.expiresAt && new Date(String(d.expiresAt)) <= new Date()) return false;

    const tokenHeaders = await extractTokenHeaders(headers);
    if (
      tokenHeaders["user-agent"] !== d["user-agent"] ||
      tokenHeaders["x-forwarded-for"] !== d["x-forwarded-for"] ||
      tokenHeaders["sec-ch-ua-platform"] !== d["sec-ch-ua-platform"]
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
