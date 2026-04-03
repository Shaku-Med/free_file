import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { PasskeyUserMessage } from "~/lib/webauthn/userMessages";

const json = (body: unknown, status = 200) => data(body, { status, headers: { "Cache-Control": "no-store" } });

export const loader = async ({ request }: { request: Request }) => {
  const user = await isAuthenticated(request, ["id", "is_memories"]);
  if (!user?.id || user.is_memories) {
    return json({ error: PasskeyUserMessage.signInAgain }, 401);
  }

  if (!db) {
    return json({ error: PasskeyUserMessage.tryAgainLater }, 503);
  }

  const { data: rows, error } = await db
    .from("user_passkeys")
    .select("id, device_name, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("user_passkeys list:", error);
    return json({ error: PasskeyUserMessage.loadPasskeysFailed }, 500);
  }

  return json({ passkeys: rows || [] }, 200);
};

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "DELETE") {
    return json({ error: PasskeyUserMessage.tryAgainLater }, 405);
  }

  const user = await isAuthenticated(request, ["id", "is_memories"]);
  if (!user?.id || user.is_memories) {
    return json({ error: PasskeyUserMessage.signInAgain }, 401);
  }

  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: PasskeyUserMessage.removePasskeyFailed }, 400);
  }

  const passkeyId = typeof body.id === "string" ? body.id : "";
  if (!passkeyId) {
    return json({ error: PasskeyUserMessage.removePasskeyFailed }, 400);
  }

  if (!db) {
    return json({ error: PasskeyUserMessage.tryAgainLater }, 503);
  }

  const { error } = await db
    .from("user_passkeys")
    .delete()
    .eq("id", passkeyId)
    .eq("user_id", user.id);

  if (error) {
    console.error("user_passkeys delete:", error);
    return json({ error: PasskeyUserMessage.removePasskeyFailed }, 500);
  }

  return json({ ok: true }, 200);
};
