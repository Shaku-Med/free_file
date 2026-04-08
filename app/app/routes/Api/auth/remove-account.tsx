import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import {
  appendAltAccountsCookie,
  readAltAccountsFromRequest,
  isValidOrigin,
} from "~/lib/Security/accountVault";

export const loader = () => data({ error: "Method Not Allowed" }, { status: 405 });

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") {
    return data({ error: "Method Not Allowed" }, { status: 405 });
  }

  if (!isValidOrigin(request)) {
    return data({ error: "Forbidden" }, { status: 403 });
  }

  const currentUser = await isAuthenticated(request);
  if (!currentUser) {
    return data({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { userId?: string };
  try {
    body = await request.json();
  } catch {
    return data({ error: "Invalid JSON" }, { status: 400 });
  }

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!userId) {
    return data({ error: "Missing userId" }, { status: 400 });
  }

  const alt = readAltAccountsFromRequest(request.headers);
  const next = alt.filter((a) => a.id !== userId);

  const headers = new Headers();
  appendAltAccountsCookie(headers, next);

  return data({ ok: true }, { status: 200, headers });
};
