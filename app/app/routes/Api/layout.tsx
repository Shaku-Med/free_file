import { isRouteErrorResponse, Outlet } from "react-router";
import { assertSafeRequest } from "~/lib/Security/requestGuard.server";
import { verifyWebhookSecret } from "~/lib/Security/webhookAuth.server";

// CSRF guard for browser-facing /api/* mutations; S2S routes use their own auth and skip it.

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const STATUS_LABELS: Record<number, string> = {
  400: "Bad request",
  404: "Not found",
  405: "Method not allowed",
};

function apiErrorResponse(status: number): Response {
  return new Response(
    JSON.stringify({ error: STATUS_LABELS[status] ?? "Internal server error" }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

function isServerToServerPath(pathname: string): boolean {
  return (
    pathname === "/api/upload-server-check" ||
    pathname === "/api/server-env" ||
    pathname === "/api/upload-job-status" ||
    pathname.startsWith("/api/internal/") ||
    pathname.startsWith("/api/webhooks/")
  );
}

// Sensitive GETs that must look like same-origin browser fetches.
function isSensitiveGet(pathname: string): boolean {
  return pathname === "/api/upload/auth";
}

export const middleware = [
  async ({ request }: { request: Request }, next: () => Promise<Response>) => {
    const method = request.method.toUpperCase();
    const pathname = new URL(request.url).pathname;

    // SECURITY: never let raw errors (message/stack) serialize into an API
    // response — log server-side, return a bare status label to the client.
    const run = async () => {
      try {
        return await next();
      } catch (error) {
        if (error instanceof Response) return error;
        const status = isRouteErrorResponse(error) ? error.status : 500;
        console.error(`[api] ${method} ${pathname} failed (${status}):`, error);
        return apiErrorResponse(status);
      }
    };

    if (verifyWebhookSecret(request) || isServerToServerPath(pathname)) {
      return run();
    }

    const needsGuard =
      MUTATING.has(method) || (method === "GET" && isSensitiveGet(pathname));

    if (needsGuard) {
      const blocked = assertSafeRequest(request);
      if (blocked) return blocked;
    }

    return run();
  },
];

const layout = () => {
  return <Outlet />;
};

export default layout;
