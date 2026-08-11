/**
 * Media-load access for /api/load/image and /api/load/preview.
 *
 * Adult + private must NOT be reachable "standalone" (address bar, bare <img>,
 * curl with only the session cookie). Those paths require an explicit
 * `Authorization: Bearer <load token>` minted by /api/load/auth.
 *
 * Public non-adult stays open (CDN-style).
 */

import db from "~/lib/Database/supabase";
import {
  canServeOwnerContent,
} from "~/lib/Security/accountStatus.server";
import { verifyLoadToken } from "~/lib/Security/loadToken.server";
import { visibilityOf, type FileVisibility } from "~/lib/Security/visibility";
import {
  isFileOwner,
  isUserEighteenPlus,
  type FileData,
} from "~/routes/Api/fun/accessControl";

const normalizeBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "t", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "f", "0", "no", "n"].includes(normalized)) return false;
    return fallback;
  }
  return fallback;
};

function bearerFromRequest(request: Request): string | null {
  const raw = request.headers.get("Authorization");
  if (!raw) return null;
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

/** Adult or private — cannot load without an explicit Authorization bearer. */
export function mediaRequiresAuthorization(file: {
  is_adult?: unknown;
  is_public?: unknown;
  visibility?: FileVisibility | unknown;
}): boolean {
  if (normalizeBoolean(file.is_adult)) return true;
  return visibilityOf(file) === "private";
}

type MediaUser = {
  id: string;
  dob: string;
  verified: boolean;
  showNsfw: boolean;
};

async function userFromLoadBearer(bearer: string): Promise<MediaUser | null> {
  const payload = await verifyLoadToken(bearer);
  if (!payload || !db) return null;

  const { data } = await db
    .from("users")
    .select("id, dob, verified, show_nsfw")
    .eq("c_usr", payload.c_usr)
    .maybeSingle();
  if (!data?.id) return null;
  if (payload.uid && String(data.id) !== payload.uid) return null;

  return {
    id: String(data.id),
    dob: typeof data.dob === "string" ? data.dob : "",
    verified: Boolean(data.verified),
    showNsfw: Boolean(data.show_nsfw),
  };
}

/**
 * Gate for image/preview loaders.
 * - Public non-adult: allow (no header).
 * - Adult/private: valid load bearer required; cookie alone is denied.
 */
export async function canAccessMediaLoad(
  request: Request,
  file: FileData,
): Promise<boolean> {
  const isAdult = normalizeBoolean(file.is_adult);
  const visibility = visibilityOf(file);

  const uploadStatus =
    typeof file.upload_status === "string"
      ? file.upload_status.trim().toLowerCase()
      : null;
  const isCompleted =
    uploadStatus === "completed" || uploadStatus === "complete";

  // Finished public/unlisted non-adult: standalone CDN ok.
  if (!isAdult && visibility !== "private") {
    if (uploadStatus && !isCompleted) {
      // Incomplete uploads stay owner-only — need bearer to prove owner.
      const bearer = bearerFromRequest(request);
      if (!bearer) return false;
      const user = await userFromLoadBearer(bearer);
      if (!user) return false;
      return isFileOwner(user.id, file.owner_id);
    }
    return canServeOwnerContent(
      file.owner_id ? String(file.owner_id) : null,
      null,
    );
  }

  // Adult or private: Authorization bearer is mandatory.
  const bearer = bearerFromRequest(request);
  if (!bearer) return false;

  const user = await userFromLoadBearer(bearer);
  if (!user) return false;

  const isOwner = isFileOwner(user.id, file.owner_id);

  if (uploadStatus && !isCompleted) {
    return isOwner;
  }

  if (visibility === "private") {
    if (!isOwner) return false;
  } else if (isAdult) {
    if (!user.showNsfw) return false;
    if (!user.verified) return false;
    if (!user.dob || !isUserEighteenPlus(user.dob)) return false;
  }

  return canServeOwnerContent(
    file.owner_id ? String(file.owner_id) : null,
    user.id,
  );
}
