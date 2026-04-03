import { data } from "react-router";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import db from "~/lib/Database/supabase";
import { getWebAuthnConfig } from "~/lib/webauthn/config";
import { storeWebAuthnChallenge } from "~/lib/webauthn/challenges";
import { PasskeyUserMessage } from "~/lib/webauthn/userMessages";
import { checkAuthRateLimit } from "~/routes/Auth/fun/rateLimit";
import { normalizeIdentifier, constantTimeDelay } from "~/routes/Auth/fun/validation";

export const loader = () => data({ error: PasskeyUserMessage.tryAgainLater }, { status: 405 });

const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  data(body, { status, headers });

async function findUserByIdentifier(normalized: string) {
  if (!db || !normalized) return null;
  const isEmail = normalized.includes("@");
  if (isEmail) {
    const { data: u, error } = await db
      .from("users")
      .select("id, verified, is_memories")
      .eq("email", normalized)
      .maybeSingle();
    if (error || !u || u.is_memories) return null;
    return u;
  }
  const { data: u, error } = await db
    .from("users")
    .select("id, verified, is_memories")
    .eq("username", normalized)
    .maybeSingle();
  if (error || !u || u.is_memories) return null;
  return u;
}

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") {
    return json({ error: PasskeyUserMessage.tryAgainLater }, 405);
  }

  const rate = checkAuthRateLimit(request, "passkey");
  if (!rate.allowed) {
    return json({ error: PasskeyUserMessage.rateLimited }, 429);
  }

  if (!db) {
    return json({ error: PasskeyUserMessage.tryAgainLater }, 503);
  }

  let identifier: string | undefined;
  try {
    const body = await request.json().catch(() => ({}));
    identifier = typeof body?.identifier === "string" ? body.identifier : undefined;
  } catch {
    identifier = undefined;
  }

  const normalized = identifier ? normalizeIdentifier(identifier) : "";
  const { rpID, origin } = getWebAuthnConfig(request);
  const flowId = crypto.randomUUID();

  let userId: string | null = null;
  let allowCredentials: Parameters<typeof generateAuthenticationOptions>[0]["allowCredentials"];

  if (normalized) {
    const user = await findUserByIdentifier(normalized);
    await constantTimeDelay(50);
    if (!user || !user.verified) {
      return json({ error: PasskeyUserMessage.loginStartFailed }, 400);
    }
    const { data: keys, error: keysError } = await db
      .from("user_passkeys")
      .select("credential_id, transports")
      .eq("user_id", user.id);

    if (keysError) {
      console.error("user_passkeys:", keysError);
      return json({ error: PasskeyUserMessage.tryAgainLater }, 500);
    }
    if (!keys?.length) {
      return json({ error: PasskeyUserMessage.loginStartFailed }, 400);
    }
    userId = user.id;
    allowCredentials = keys.map((r: { credential_id: string; transports: string[] | null }) => ({
      id: r.credential_id,
      transports: r.transports || undefined,
    })) as typeof allowCredentials;
  }

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials,
    userVerification: "preferred",
  });

  const ok = await storeWebAuthnChallenge(flowId, options.challenge, "authentication", userId);
  if (!ok) {
    return json({ error: PasskeyUserMessage.tryAgainLater }, 500);
  }

  return json(
    { flowId, options, rp: { rpID, origin } },
    200,
    { "Cache-Control": "no-store" }
  );
};
