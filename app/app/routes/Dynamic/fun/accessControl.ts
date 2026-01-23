import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";

interface FileData {
  is_adult: boolean;
  is_public: boolean;
  owner_id: string;
}

interface UserData {
  id: string;
  dob: string;
  verified: boolean;
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
  const isPublic = normalizeBoolean(file.is_public, true);
  const uploadStatus = typeof (file as any).upload_status === 'string'
    ? (file as any).upload_status.trim().toLowerCase()
    : null;
  const isCompleted = uploadStatus === 'completed' || uploadStatus === 'complete';

  const user = await isAuthenticated(request, ['id', 'dob', 'verified']) as UserData | null | boolean;

  if (!user || typeof user === 'boolean') {
    if (uploadStatus && !isCompleted) {
      return { allowed: false, reason: 'not_authenticated' };
    }
    if (isAdult || !isPublic) {
      return { allowed: false, reason: 'not_authenticated' };
    }
    return { allowed: true };
  }

  if (isAdult) {
    try {
      if (db) {
        const { data } = await db
          .from('users')
          .select('show_nsfw')
          .eq('id', user.id)
          .single();
        if (!data?.show_nsfw) {
          return { allowed: false, reason: 'not_authenticated' };
        }
      } else {
        return { allowed: false, reason: 'not_authenticated' };
      }
    } catch {
      return { allowed: false, reason: 'not_authenticated' };
    }
    if (!user.verified) {
      return { allowed: false, reason: 'not_authenticated' };
    }
    if (!isUserEighteenPlus(user.dob)) {
      return { allowed: false, reason: 'underage' };
    }
  }

  if (!isPublic) {
    if (!isFileOwner(user.id, file.owner_id)) {
      return { allowed: false, reason: 'not_owner' };
    }
  }

  return { allowed: true };
};

