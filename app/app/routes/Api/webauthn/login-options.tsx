import { data } from "react-router";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import db from "~/lib/Database/supabase";
import { getWebAuthnConfig } from "~/lib/webauthn/config";
import { storeWebAuthnChallenge } from "~/lib/webauthn/challenges";
import { PasskeyUserMessage } from "~/lib/webauthn/userMessages";
import { checkAuthRateLimit } from "~/routes/Auth/fun/rateLimit.server";
import { isSameOrigin } from "~/lib/Security/sameOrigin.server";

export const loader = () => data({ error: PasskeyUserMessage.tryAgainLater }, { status: 405 });

const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  data(body, { status, headers });

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") {
    return json({ error: PasskeyUserMessage.tryAgainLater }, 405);
  }
  if (!isSameOrigin(request)) {
    return json({ error: PasskeyUserMessage.tryAgainLater }, 403);
  }

  const rate = await checkAuthRateLimit(request, "passkey");
  if (!rate.allowed) {
    return json({ error: PasskeyUserMessage.rateLimited }, 429);
  }

  if (!db) {
    return json({ error: PasskeyUserMessage.tryAgainLater }, 503);
  }

  // Always let the device pick the passkey. Looking the account up from the typed
  // username failed whenever the box held anything else, and the different reply
  // told anyone which usernames have passkeys (plus their credential ids).
  const { rpID, origin } = getWebAuthnConfig(request);
  const flowId = crypto.randomUUID();

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
  });

  const ok = await storeWebAuthnChallenge(flowId, options.challenge, "authentication", null);
  if (!ok) {
    return json({ error: PasskeyUserMessage.tryAgainLater }, 500);
  }

  return json(
    { flowId, options, rp: { rpID, origin } },
    200,
    { "Cache-Control": "no-store" }
  );
};
