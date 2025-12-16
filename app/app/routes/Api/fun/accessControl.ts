import { isAuthenticated } from "~/lib/Security/Password";

interface FileData {
  is_adult: boolean;
  is_public: boolean;
  owner_id: string;
  [key: string]: any;
}

interface UserData {
  id: string;
  dob: string;
  verified: boolean;
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

export const canAccessFile = async (
  request: Request,
  file: FileData
): Promise<boolean> => {
  if (!file.is_adult && file.is_public) {
    return true;
  }

  const user = await isAuthenticated(request, ['id', 'dob', 'verified']) as UserData | null | boolean;

  if (!user || typeof user === 'boolean') {
    return false;
  }

  if (file.is_adult) {
    if (!user.verified) {
      return false;
    }
    if (!isUserEighteenPlus(user.dob)) {
      return false;
    }
  }

  if (!file.is_public) {
    if (!isFileOwner(user.id, file.owner_id)) {
      return false;
    }
  }

  return true;
};

export const filterFilesByAccess = async <T extends FileData>(
  request: Request,
  files: T[]
): Promise<T[]> => {
  const filteredFiles: T[] = [];

  for (const file of files) {
    const hasAccess = await canAccessFile(request, file);
    if (hasAccess) {
      filteredFiles.push(file);
    }
  }

  return filteredFiles;
};

