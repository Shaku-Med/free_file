/**
 * POST /api/studio/delete-verify  email-code "sudo" gate for permanent deletes.
 *
 *   { step: "status" }                -> { verified }       cookie still valid?
 *   { step: "send" }                  -> { sent }           email a 6-digit code (20 min TTL)
 *   { step: "verify", code: "123456" }-> { verified } + sets the del_sudo session cookie (2h)
 *
 * Security: caller must be logged in; the code goes to THEIR OWN email (read
 * from the DB, never from the client); bcrypt-hashed at rest; max 5 attempts;
 * rate-limited per user AND per IP; all failures return the same generic error.
 */
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import {
  generateVerificationCode,
  hashVerificationCode,
  verifyCode,
} from "~/routes/Auth/fun/verification";
import { sendVerificationEmail } from "~/routes/Auth/fun/email";
import { rateLimiter } from "~/routes/Auth/fun/rateLimit";
import { getClientIP } from "~/lib/Security/unsharedkeyEncryption/Combined/Verification/GetIp";
import {
  issueDeleteSudoToken,
  appendDeleteSudoCookie,
  hasDeleteSudo,
} from "~/lib/Security/deleteSudo.server";

const CODE_TTL_MS = 20 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const toJson = (body: unknown, status = 200, headers?: Headers) => {
  const h = headers ?? new Headers();
  h.set("Content-Type", "application/json");
  h.set("Cache-Control", "private, no-store");
  return new Response(JSON.stringify(body), { status, headers: h });
};

const denyErr = (status = 400) => toJson({ error: "Something's wrong." }, status);

async function clientIpKey(request: Request): Promise<string> {
  const ip = (await getClientIP(request.headers).catch(() => null)) as unknown;
  if (typeof ip === "string" && ip && ip !== "unknown") return ip;
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== "POST") return denyErr(405);
    const user = await isAuthenticated(request, ["id", "email"]).catch(() => null);
    if (!user?.id || !user?.email || !db) return denyErr(401);

    let body: { step?: unknown; code?: unknown };
    try {
      body = (await request.json()) as { step?: unknown; code?: unknown };
    } catch {
      return denyErr(400);
    }
    const step = typeof body.step === "string" ? body.step : "";

    if (step === "status") {
      return toJson({ verified: await hasDeleteSudo(request, user.id) });
    }

    if (step === "send") {
      const ipKey = await clientIpKey(request);
      const byUser = rateLimiter.checkLimit(user.id, "delete_sudo_send", 3, 10 * 60 * 1000, 30 * 60 * 1000);
      const byIp = rateLimiter.checkLimit(ipKey, "delete_sudo_send_ip", 10, 10 * 60 * 1000, 30 * 60 * 1000);
      if (!byUser.allowed || !byIp.allowed) return denyErr(429);

      const code = generateVerificationCode();
      const codeHash = await hashVerificationCode(code);
      if (!codeHash) return denyErr(500);

      const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
      // Delete + insert so a re-send starts with a fresh attempts counter.
      await db.from("sudo_verification").delete().eq("user_id", user.id);
      const { error: insertError } = await db
        .from("sudo_verification")
        .insert({ user_id: user.id, code_hash: codeHash, expires_at: expiresAt });
      if (insertError) {
        console.error("[delete-verify] insert", insertError);
        return denyErr(500);
      }

      const sent = await sendVerificationEmail(user.email, code, "delete");
      if (!sent) return denyErr(500);
      return toJson({ sent: true });
    }

    if (step === "verify") {
      const ipKey = await clientIpKey(request);
      const byUser = rateLimiter.checkLimit(user.id, "delete_sudo_verify", 10, 10 * 60 * 1000, 30 * 60 * 1000);
      const byIp = rateLimiter.checkLimit(ipKey, "delete_sudo_verify_ip", 20, 10 * 60 * 1000, 30 * 60 * 1000);
      if (!byUser.allowed || !byIp.allowed) return denyErr(429);

      const code = typeof body.code === "string" ? body.code.trim() : "";
      if (!/^\d{6}$/.test(code)) return denyErr(400);

      const { data: record, error: recErr } = await db
        .from("sudo_verification")
        .select("code_hash, expires_at, attempts")
        .eq("user_id", user.id)
        .maybeSingle();
      if (recErr || !record) return denyErr(400);

      if (new Date(record.expires_at as string) < new Date()) {
        await db.from("sudo_verification").delete().eq("user_id", user.id);
        return denyErr(400);
      }
      if (Number(record.attempts) >= MAX_ATTEMPTS) {
        await db.from("sudo_verification").delete().eq("user_id", user.id);
        return denyErr(400);
      }

      const ok = await verifyCode(code, record.code_hash as string);
      if (!ok) {
        await db.rpc("increment_sudo_verification_attempts", { p_user_id: user.id });
        return denyErr(400);
      }

      // One-time: the code dies the moment it succeeds.
      await db.from("sudo_verification").delete().eq("user_id", user.id);

      const token = await issueDeleteSudoToken(user.id);
      if (!token) return denyErr(500);
      const headers = new Headers();
      appendDeleteSudoCookie(headers, token);
      return toJson({ verified: true }, 200, headers);
    }

    return denyErr(400);
  } catch (e) {
    console.error("[delete-verify] unexpected", e);
    return denyErr(500);
  }
};

export const loader = () => denyErr(405);
