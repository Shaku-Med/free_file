import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";

interface FileData {
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
  return canAccessFileWithContext(file, context);
};

export const filterFilesByAccess = async <T extends FileData>(
  request: Request,
  files: T[]
): Promise<T[]> => {
  const filteredFiles: T[] = [];
  const context = await getUserAccessContext(request);

  for (const file of files) {
    const hasAccess = canAccessFileWithContext(file, context);
    if (hasAccess) {
      filteredFiles.push(file);
    }
  }

  return filteredFiles;
};

