import db from "~/lib/Database/supabase";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export type WebAuthnChallengeKind = "registration" | "authentication";

export async function storeWebAuthnChallenge(
  id: string,
  challenge: string,
  kind: WebAuthnChallengeKind,
  userId: string | null
): Promise<boolean> {
  if (!db) return false;
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
  await db.from("webauthn_challenges").delete().lt("expires_at", new Date().toISOString());
  const { error } = await db.from("webauthn_challenges").insert({
    id,
    challenge,
    user_id: userId,
    kind,
    expires_at: expiresAt,
  });
  if (error) {
    console.error("storeWebAuthnChallenge:", error);
    return false;
  }
  return true;
}

export type ConsumedChallenge = {
  challenge: string;
  user_id: string | null;
  kind: WebAuthnChallengeKind;
};

export async function consumeWebAuthnChallenge(
  id: string,
  expectedKind: WebAuthnChallengeKind
): Promise<ConsumedChallenge | null> {
  if (!db) return null;
  const { data, error } = await db
    .from("webauthn_challenges")
    .delete()
    .eq("id", id)
    .select("challenge, user_id, kind, expires_at")
    .maybeSingle();

  if (error || !data) {
    return null;
  }
  if (data.kind !== expectedKind) {
    return null;
  }
  if (new Date(data.expires_at).getTime() < Date.now()) {
    return null;
  }
  return {
    challenge: data.challenge,
    user_id: data.user_id,
    kind: data.kind as WebAuthnChallengeKind,
  };
}
