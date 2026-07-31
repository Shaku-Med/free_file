import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import {
  canServeOwnerContent,
  getHiddenOwnerIds,
} from "~/lib/Security/accountStatus.server";

export interface FileData {
  is_adult: boolean;
  is_public: boolean;
  owner_id: string;
  upload_status?: string;
  [key: string]: any;
}

interface UserData {
  id: string;
  dob: string;
  verified: boolean;
}

interface AccessContext {
  user: UserData | null;
  showNsfw: boolean;
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

const getUserAccessContext = async (request: Request): Promise<AccessContext> => {
  const user = await isAuthenticated(request, ['id', 'dob', 'verified']) as UserData | null | boolean;
  if (!user || typeof user === 'boolean') {
    return { user: null, showNsfw: false };
  }
  if (!db) {
    return { user, showNsfw: false };
  }
  try {
    const { data } = await db
      .from('users')
      .select('show_nsfw')
      .eq('id', user.id)
      .single();
    return { user, showNsfw: Boolean(data?.show_nsfw) };
  } catch {
    return { user, showNsfw: false };
  }
};

const canAccessFileWithContext = (file: FileData, context: AccessContext): boolean => {
  const isAdult = normalizeBoolean(file.is_adult);
  const isPublic = normalizeBoolean(file.is_public, true);

  const uploadStatus = typeof file.upload_status === 'string'
    ? file.upload_status.trim().toLowerCase()
    : null;
  const isCompleted = uploadStatus === 'completed' || uploadStatus === 'complete';
  if (uploadStatus && !isCompleted) {
    if (!context.user) {
      return false;
    }
    return isFileOwner(context.user.id, file.owner_id);
  }

  if (!isAdult && isPublic) {
    return true;
  }

  if (!context.user) {
    return false;
  }

  if (isAdult) {
    if (!context.showNsfw) {
      return false;
    }
    if (!context.user.verified) {
      return false;
    }
    if (!isUserEighteenPlus(context.user.dob)) {
      return false;
    }
  }

  if (!isPublic) {
    if (!isFileOwner(context.user.id, file.owner_id)) {
      return false;
    }
  }

  return true;
};

export const canAccessFile = async (
  request: Request,
  file: FileData
): Promise<boolean> => {
  const context = await getUserAccessContext(request);
  if (!canAccessFileWithContext(file, context)) return false;

  // Account enforcement (docs/Moderation.md): a restricted/terminated owner's
  // content is withheld from everyone but the owner, including via a direct
  // link. Applied here rather than per-route so no read path can forget it.
  const ownerId = (file as { owner_id?: unknown }).owner_id;
  return canServeOwnerContent(
    ownerId ? String(ownerId) : null,
    context.user?.id ? String(context.user.id) : null,
  );
};

export const filterFilesByAccess = async <T extends FileData>(
  request: Request,
  files: T[]
): Promise<T[]> => {
  const context = await getUserAccessContext(request);

  const allowed: T[] = [];
  for (const file of files) {
    if (canAccessFileWithContext(file, context)) allowed.push(file);
  }
  if (allowed.length === 0) return allowed;

  // ONE batched status lookup for the whole page of rows — a per-row query here
  // would add a round trip per feed item.
  const hidden = await getHiddenOwnerIds(
    allowed.map((f) => {
      const owner = (f as { owner_id?: unknown }).owner_id;
      return owner ? String(owner) : null;
    }),
  );
  if (hidden.size === 0) return allowed;

  const viewerId = context.user?.id ? String(context.user.id) : null;
  return allowed.filter((f) => {
    const owner = (f as { owner_id?: unknown }).owner_id;
    const ownerId = owner ? String(owner) : '';
    // The owner keeps seeing their own library; a restriction unlists content,
    // it doesn't confiscate it.
    return !hidden.has(ownerId) || (viewerId !== null && ownerId === viewerId);
  });
};

