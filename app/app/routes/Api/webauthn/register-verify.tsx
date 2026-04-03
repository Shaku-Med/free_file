import { data } from "react-router";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { getWebAuthnConfig } from "~/lib/webauthn/config";
import { consumeWebAuthnChallenge } from "~/lib/webauthn/challenges";
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

  const user = await isAuthenticated(request, ["id", "verified", "is_memories"]);
  if (!user?.id || user.is_memories) {
    return json({ error: PasskeyUserMessage.signInAgain }, 401);
  }
  if (!user.verified) {
    return json({ error: PasskeyUserMessage.confirmEmailFirst }, 403);
  }

  let body: { flowId?: string; response?: RegistrationResponseJSON; deviceName?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: PasskeyUserMessage.addPasskeyFailed }, 400);
  }

  const flowId = typeof body.flowId === "string" ? body.flowId : "";
  const regResponse = body.response;
  const deviceName =
    typeof body.deviceName === "string" ? body.deviceName.trim().slice(0, 120) : null;

  if (!flowId || !regResponse?.id) {
    return json({ error: PasskeyUserMessage.addPasskeyFailed }, 400);
  }

  const stored = await consumeWebAuthnChallenge(flowId, "registration");
  if (!stored || stored.user_id !== user.id) {
    return json({ error: PasskeyUserMessage.addPasskeyFailed }, 400);
  }

  const { expectedOrigins, rpID } = getWebAuthnConfig(request);

  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response: regResponse,
      expectedChallenge: stored.challenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: rpID,
    });
  } catch (e) {
    console.error("webauthn register-verify:", e);
    return json({ error: PasskeyUserMessage.addPasskeyFailed }, 400);
  }

  if (!verification.verified || !verification.registrationInfo) {
    return json({ error: PasskeyUserMessage.addPasskeyFailed }, 400);
  }

  const { credential } = verification.registrationInfo;
  let publicKeyB64: string;
  try {
    publicKeyB64 = Buffer.from(credential.publicKey).toString("base64");
  } catch (e) {
    console.error("webauthn register-verify credential buffer:", e);
    return json({ error: PasskeyUserMessage.addPasskeyFailed }, 400);
  }

  if (!db) {
    return json({ error: PasskeyUserMessage.tryAgainLater }, 503);
  }

  const { error: insertError } = await db.from("user_passkeys").insert({
    user_id: user.id,
    credential_id: credential.id,
    public_key: publicKeyB64,
    counter: credential.counter,
    transports: credential.transports ?? null,
    device_name: deviceName || null,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return json({ error: PasskeyUserMessage.passkeyAlreadySaved }, 409);
    }
    console.error("user_passkeys insert:", insertError);
    return json({ error: PasskeyUserMessage.tryAgainLater }, 500);
  }

  return json({ ok: true }, 200, { "Cache-Control": "no-store" });
};
