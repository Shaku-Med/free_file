import { Outlet } from "react-router";
import { assertSafeRequest } from "~/lib/Security/requestGuard.server";
import { verifyWebhookSecret } from "~/lib/Security/webhookAuth.server";

/**
 * CSRF / cookie-replay guard for browser-facing /api/* mutations.
 *
 * Why: a logged-in victim visiting an attacker's page can be tricked into
 * firing credentialed requests at our origin. SameSite=Lax helps for many
 * cross-site POSTs, but Sec-Fetch + Origin checks (assertSafeRequest) close
 * remaining gaps and block Postman/curl cookie replay.
 *
 * Server-to-server routes authenticate with UPLOAD_WEBHOOK_SECRET (or their
 * own bearer) and skip this browser-shape guard.
 */

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Paths that enforce their own S2S auth — never apply browser Sec-Fetch here. */
function isServerToServerPath(pathname: string): boolean {
  return (
    pathname === "/api/upload-server-check" ||
    pathname === "/api/server-env" ||
    pathname === "/api/upload-job-status" ||
    pathname.startsWith("/api/internal/") ||
    pathname.startsWith("/api/webhooks/")
  );
}

/** Sensitive GETs that must look like same-origin browser fetches. */
function isSensitiveGet(pathname: string): boolean {
  return pathname === "/api/upload/auth";
}

export const middleware = [
  async ({ request }: { request: Request }, next: () => Promise<Response>) => {
    if (verifyWebhookSecret(request) || isServerToServerPath(new URL(request.url).pathname)) {
      return next();
    }

    const method = request.method.toUpperCase();
    const pathname = new URL(request.url).pathname;
    const needsGuard =
      MUTATING.has(method) || (method === "GET" && isSensitiveGet(pathname));

    if (needsGuard) {
      const blocked = assertSafeRequest(request);
      if (blocked) return blocked;
    }

    return next();
  },
];

const layout = () => {
  return <Outlet />;
};

export default layout;
