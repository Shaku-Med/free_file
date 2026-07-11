import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import { getCookie } from "~/lib/Security/Token";
import { appendSessionCookie } from "~/routes/Auth/fun/auth";
import {
  MAX_ALT_ACCOUNTS,
  type AltAccount,
  appendAltAccountsCookie,
  readAltAccountsFromRequest,
  revalidateParkedToken,
} from "~/lib/Security/accountVault";
import { isSameOrigin } from "~/lib/Security/sameOrigin.server";
import { assertSafeRequest } from "~/lib/Security/requestGuard.server";

export const loader = () => data({ error: "Method Not Allowed" }, { status: 405 });

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") {
    return data({ error: "Method Not Allowed" }, { status: 405 });
  }

  const blocked = assertSafeRequest(request);
  if (blocked) return blocked;
  if (!isSameOrigin(request)) {
    return data({ error: "Forbidden" }, { status: 403 });
  }

  const currentUser = await isAuthenticated(request, ["id", "username", "profile_pic"]);
  if (!currentUser?.id) {
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
  const target = alt.find((a) => a.id === userId);
  if (!target) {
    return data({ error: "Account not found" }, { status: 404 });
  }

  const verified = await revalidateParkedToken(target.token);
  if (!verified || verified.id !== target.id) {
    const cleaned = alt.filter((a) => a.id !== userId);
    const headers = new Headers();
    appendAltAccountsCookie(headers, cleaned);
    return data(
      { error: "This saved session is no longer valid. It has been removed." },
      { status: 403, headers }
    );
  }

  const headers = new Headers();
  const currentToken = getCookie("c_user", request.headers);

  let nextVault = alt.filter((a) => a.id !== userId);

  if (currentToken && currentUser.id !== userId) {
    const uname = typeof currentUser.username === "string" ? currentUser.username : "?";
    if (!nextVault.some((a) => a.id === currentUser.id)) {
      const parked: AltAccount = { token: currentToken, id: currentUser.id, u: uname };
      const pic =
        typeof currentUser.profile_pic === "string" ? currentUser.profile_pic.trim() : "";
      if (pic && pic.length <= 300) parked.pic = pic;
      nextVault.push(parked);
    }
  }

  nextVault = nextVault.slice(-MAX_ALT_ACCOUNTS);

  appendSessionCookie(headers, target.token);
  appendAltAccountsCookie(headers, nextVault);

  return data({ ok: true }, { status: 200, headers });
};
