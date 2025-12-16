import { isAuthenticated } from "~/lib/Security/Password";

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

  const user = await isAuthenticated(request, ['id', 'dob', 'verified']) as UserData | null | boolean;

  if (!user || typeof user === 'boolean') {
    if (file.is_adult || !file.is_public) {
      return { allowed: false, reason: 'not_authenticated' };
    }
    return { allowed: true };
  }

  if (file.is_adult) {
    if (!user.verified) {
      return { allowed: false, reason: 'not_authenticated' };
    }
    if (!isUserEighteenPlus(user.dob)) {
      return { allowed: false, reason: 'underage' };
    }
  }

  if (!file.is_public) {
    if (!isFileOwner(user.id, file.owner_id)) {
      return { allowed: false, reason: 'not_owner' };
    }
  }

  return { allowed: true };
};

