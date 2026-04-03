import { data } from "react-router";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { isoUint8Array } from "@simplewebauthn/server/helpers";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { getWebAuthnConfig } from "~/lib/webauthn/config";
import { storeWebAuthnChallenge } from "~/lib/webauthn/challenges";
import { PasskeyUserMessage } from "~/lib/webauthn/userMessages";
import { checkAuthRateLimit } from "~/routes/Auth/fun/rateLimit";

export const loader = () => data({ error: PasskeyUserMessage.tryAgainLater }, { status: 405 });

const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  data(body, { status, headers });

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") {
    return json({ error: PasskeyUserMessage.tryAgainLater }, 405);
  }

  const rate = checkAuthRateLimit(request, "passkey");
  if (!rate.allowed) {
    return json({ error: PasskeyUserMessage.rateLimited }, 429);
  }

  const user = await isAuthenticated(request, ["id", "verified", "is_memories", "username"]);
  if (!user?.id || user.is_memories) {
    return json({ error: PasskeyUserMessage.signInAgain }, 401);
  }
  if (!user.verified) {
    return json({ error: PasskeyUserMessage.confirmEmailFirst }, 403);
  }

  if (!db) {
    return json({ error: PasskeyUserMessage.tryAgainLater }, 503);
  }

  const { data: rows, error: listError } = await db
    .from("user_passkeys")
    .select("credential_id, transports")
    .eq("user_id", user.id);

  if (listError) {
    console.error("user_passkeys list:", listError);
    return json({ error: PasskeyUserMessage.tryAgainLater }, 500);
  }

  const excludeCredentials = (rows || []).map((r: { credential_id: string; transports: string[] | null }) => ({
    id: r.credential_id,
    transports: r.transports || undefined,
  })) as Parameters<typeof generateRegistrationOptions>[0]["excludeCredentials"];

  const { rpID, rpName, origin } = getWebAuthnConfig(request);
  const flowId = crypto.randomUUID();

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.username || user.id,
    userDisplayName: user.username || "Account",
    userID: isoUint8Array.fromUTF8String(user.id),
    attestationType: "none",
    excludeCredentials,
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  const ok = await storeWebAuthnChallenge(flowId, options.challenge, "registration", user.id);
  if (!ok) {
    return json({ error: PasskeyUserMessage.tryAgainLater }, 500);
  }

  return json(
    { flowId, options, rp: { rpID, origin } },
    200,
    { "Cache-Control": "no-store" }
  );
};
