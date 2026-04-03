import { data } from "react-router";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import db from "~/lib/Database/supabase";
import { getWebAuthnConfig } from "~/lib/webauthn/config";
import { consumeWebAuthnChallenge } from "~/lib/webauthn/challenges";
import { PasskeyUserMessage } from "~/lib/webauthn/userMessages";
import { appendSessionCookie, issueCUserSessionToken } from "~/routes/Auth/fun/auth";
import { checkAuthRateLimit, resetAuthRateLimit } from "~/routes/Auth/fun/rateLimit";

export const loader = () => data({ error: PasskeyUserMessage.tryAgainLater }, { status: 405 });

function safeRedirectPath(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }
  return value.length > 500 ? fallback : value;
}

const json = (body: unknown, status = 200, headers?: Headers) => {
  const h = headers ?? new Headers();
  if (!h.has("Cache-Control")) {
    h.set("Cache-Control", "no-store");
  }
  return data(body, { status, headers: h });
};

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") {
    return json({ error: PasskeyUserMessage.tryAgainLater }, 405);
  }

  const rate = checkAuthRateLimit(request, "passkey");
  if (!rate.allowed) {
    return json({ error: PasskeyUserMessage.rateLimited }, 429);
  }

  let body: { flowId?: string; response?: AuthenticationResponseJSON; redirect?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: PasskeyUserMessage.loginDidNotWork }, 400);
  }

  const flowId = typeof body.flowId === "string" ? body.flowId : "";
  const authResponse = body.response;
  if (!flowId || !authResponse?.id) {
    return json({ error: PasskeyUserMessage.loginDidNotWork }, 400);
  }

  const stored = await consumeWebAuthnChallenge(flowId, "authentication");
  if (!stored) {
    return json({ error: PasskeyUserMessage.loginDidNotWork }, 400);
  }

  if (!db) {
    return json({ error: PasskeyUserMessage.tryAgainLater }, 503);
  }

  const { data: row, error: rowError } = await db
    .from("user_passkeys")
    .select("id, user_id, credential_id, public_key, counter, transports")
    .eq("credential_id", authResponse.id)
    .maybeSingle();

  if (rowError || !row) {
    return json({ error: PasskeyUserMessage.loginDidNotWork }, 400);
  }

  if (stored.user_id && stored.user_id !== row.user_id) {
    return json({ error: PasskeyUserMessage.loginDidNotWork }, 400);
  }

  const { data: account, error: userError } = await db
    .from("users")
    .select("id, c_usr, verified, is_memories")
    .eq("id", row.user_id)
    .maybeSingle();

  if (userError || !account?.c_usr || account.is_memories || !account.verified) {
    return json({ error: PasskeyUserMessage.loginDidNotWork }, 400);
  }

  const publicKey = new Uint8Array(Buffer.from(row.public_key, "base64"));
  const { origin, rpID } = getWebAuthnConfig(request);

  const verification = await verifyAuthenticationResponse({
    response: authResponse,
    expectedChallenge: stored.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: row.credential_id,
      publicKey,
      counter: Number(row.counter),
      transports: row.transports || undefined,
    },
  });

  if (!verification.verified) {
    return json({ error: PasskeyUserMessage.loginDidNotWork }, 400);
  }

  const newCounter = verification.authenticationInfo.newCounter;
  await db.from("user_passkeys").update({ counter: newCounter }).eq("id", row.id);

  const token = await issueCUserSessionToken(account.c_usr);
  if (!token) {
    return json({ error: PasskeyUserMessage.tryAgainLater }, 500);
  }

  resetAuthRateLimit(request, "passkey");

  const headers = new Headers();
  appendSessionCookie(headers, token);

  const redirectTo = safeRedirectPath(body.redirect, "/");
  return json({ ok: true, redirect: redirectTo }, 200, headers);
};
