import { getCachedUserAccessContext } from "~/lib/Services/accessCache.server";
import { visibilityOf, type FileVisibility } from '~/lib/Security/visibility';

interface FileData {
  is_adult: boolean;
  is_public: boolean;
  owner_id: string;
}

const normalizeBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 't', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', 'f', '0', 'no', 'n'].includes(normalized)) return false;
    return fallback;
  }
  return fallback;
};

interface AccessControlResult {
  allowed: boolean;
  reason?: 'not_authenticated' | 'underage' | 'not_owner' | 'private_file';
}

export const isUserEighteenPlus = (dob: string): boolean => {
  const birthDate = new Date(dob);
  const today = new Date();
  const age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    return age - 1 >= 18;
  }
  
  return age >= 18;
};

export const isFileOwner = (userId: string, ownerId: string): boolean => {
  return userId === ownerId;
};

export const checkFileAccess = async (
  request: Request,
  file: FileData | null
): Promise<AccessControlResult> => {
  if (!file) {
    return { allowed: false, reason: 'not_authenticated' };
  }

  const isAdult = normalizeBoolean(file.is_adult);
  // Three state visibility. Gating on is_public alone would treat UNLISTED as
  // owner only, which is the opposite of what unlisted means and would break
  // playback for every auto-unlisted adult file.
  const visibility = visibilityOf(file);
  const isOwnerOnly = visibility === 'private';
  const uploadStatus = typeof (file as any).upload_status === 'string'
    ? (file as any).upload_status.trim().toLowerCase()
    : null;
  const isCompleted = uploadStatus === 'completed' || uploadStatus === 'complete';

  // Single cached lookup replaces the previous `isAuthenticated` + `users.show_nsfw`
  // round trips. On the hot path (one call per HLS segment / image thumb) this is
  // the difference between 2 DB hits and 0 most of the time.
  const user = await getCachedUserAccessContext(request);

  if (!user) {
    if (uploadStatus && !isCompleted) {
      return { allowed: false, reason: 'not_authenticated' };
    }
    if (isAdult || isOwnerOnly) {
      return { allowed: false, reason: 'not_authenticated' };
    }
    return { allowed: true };
  }

  if (isAdult) {
    if (!user.showNsfw) {
      return { allowed: false, reason: 'not_authenticated' };
    }
    if (!user.verified) {
      return { allowed: false, reason: 'not_authenticated' };
    }
    if (!isUserEighteenPlus(user.dob)) {
      return { allowed: false, reason: 'underage' };
    }
  }

  // Private is owner only. Unlisted is reachable by anyone holding the link;
  // keeping it out of feeds and search is SQL's job, not this function's.
  if (isOwnerOnly) {
    if (!isFileOwner(user.id, file.owner_id)) {
      return { allowed: false, reason: 'not_owner' };
    }
  }

  return { allowed: true };
};

