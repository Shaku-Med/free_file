import db from '~/lib/Database/supabase';
import { PasswordHash, CreatePassword, VerifyPassword } from '~/lib/Security/Password';
import { generateVerificationCode, hashVerificationCode, saveVerificationCode } from './verification';
import { sendVerificationEmail as sendEmail } from './email';
import { EncryptCombine } from '~/lib/Security/unsharedkeyEncryption/Combined/Combined';
import { getAllKeys } from '~/lib/Security/unsharedkeyEncryption/Combined/Verification/TokenKeys';

export interface SignupData {
  username: string;
  email: string;
  password: string;
  dob: string;
}

export interface LoginData {
  identifier: string;
  password: string;
}

export const createUser = async (data: SignupData): Promise<{ success: boolean; userId?: string; error?: string }> => {
  try {
    if (!db) {
      return { success: false, error: 'Database not initialized' };
    }

    const { data: existingUsers, error: checkError } = await db
      .from('users')
      .select('id, email, username, is_memories');

    if (checkError) {
      console.error('Error checking existing users:', checkError);
      return { success: false, error: 'Failed to check existing users' };
    }

    if (existingUsers) {
      const emailUser = existingUsers.find((user: { email: string; is_memories?: boolean }) => user.email.toLowerCase() === data.email.toLowerCase());
      if (emailUser) {
        if (emailUser.is_memories) {
          return { success: false, error: 'Invalid username/email or password' };
        }
        return { success: false, error: 'Email already exists' };
      }

      const usernameUser = existingUsers.find((user: { username: string; is_memories?: boolean }) => user.username.toLowerCase() === data.username.toLowerCase());
      if (usernameUser) {
        if (usernameUser.is_memories) {
          return { success: false, error: 'Invalid username/email or password' };
        }
        return { success: false, error: 'Username already exists' };
      }
    }

    const unverifiedExpire = new Date();
    unverifiedExpire.setDate(unverifiedExpire.getDate() + 2);

    const { data: user, error } = await db
      .from('users')
      .insert({
        username: data.username,
        email: data.email,
        dob: data.dob,
        verified: false,
        unverified_expire: unverifiedExpire.toISOString()
      })
      .select('id')
      .single();

    if (error || !user) {
      console.error('Error creating user:', error);
      return { success: false, error: 'Failed to create user' };
    }

    const passwordHash = await CreatePassword(data.password);
    if (!passwordHash) {
      return { success: false, error: 'Failed to hash password' };
    }

    const { error: passwordError } = await db
      .from('passwords')
      .insert({
        id: user.id,
        password: passwordHash
      });

    if (passwordError) {
      console.error('Error creating password:', passwordError);
      await db.from('users').delete().eq('id', user.id);
      return { success: false, error: 'Failed to create password' };
    }

    const code = generateVerificationCode();
    const codeHash = await hashVerificationCode(code);
    
    if (!codeHash) {
      return { success: false, error: 'Failed to generate verification code' };
    }

    const saved = await saveVerificationCode(user.id, codeHash, 1);
    if (!saved) {
      return { success: false, error: 'Failed to save verification code' };
    }

    const emailSent = await sendEmail(data.email, code, 'signup');
    if (!emailSent) {
      console.warn('Failed to send verification email, but user created');
    }

    return { success: true, userId: user.id };
  } catch (error) {
    console.error('Error in createUser:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
};

export const loginUser = async (data: LoginData, request: Request): Promise<{ success: boolean; error?: string; token?: string; userId?: string; email?: string; needsVerification?: boolean }> => {
  try {
    if (!db) {
      return { success: false, error: 'Database not initialized' };
    }

    const isEmail = data.identifier.includes('@');
    let userId: string;
    let userEmail: string;
    let userC_usr: string;
    let isVerified: boolean;
    let isMemories: boolean;

    if (isEmail) {
      const { data: userData, error } = await db
        .from('users')
        .select('id, email, username, c_usr, verified, is_memories')
        .eq('email', data.identifier.toLowerCase())
        .maybeSingle();

      if (error || !userData) {
        return { success: false, error: 'Invalid username/email or password' };
      }
      userId = userData.id;
      userEmail = userData.email;
      userC_usr = userData.c_usr;
      isVerified = userData.verified;
      isMemories = userData.is_memories;
    } else {
      const { data: allUsers, error: fetchError } = await db
        .from('users')
        .select('id, email, username, c_usr, verified, is_memories');

      if (fetchError || !allUsers) {
        return { success: false, error: 'Invalid username/email or password' };
      }

      const foundUser = allUsers.find((u: { username: string }) => u.username.toLowerCase() === data.identifier.toLowerCase());
      if (!foundUser) {
        return { success: false, error: 'Invalid username/email or password' };
      }
      userId = foundUser.id;
      userEmail = foundUser.email;
      userC_usr = foundUser.c_usr;
      isVerified = foundUser.verified;
      isMemories = foundUser.is_memories;
    }

    if (isMemories) {
      return { success: false, error: 'Invalid username/email or password' };
    }

    const { data: passwordData, error: passwordError } = await db
      .from('passwords')
      .select('password')
      .eq('id', userId)
      .maybeSingle();

    if (passwordError || !passwordData) {
      return { success: false, error: 'Invalid username/email or password' };
    }

    const isValid = await VerifyPassword(data.password, passwordData.password);
    if (!isValid) {
      return { success: false, error: 'Invalid username/email or password' };
    }

    if (!isVerified) {
      const code = generateVerificationCode();
      const codeHash = await hashVerificationCode(code);
      
      if (codeHash) {
        await saveVerificationCode(userId, codeHash, 1);
        await sendEmail(userEmail, code, 'signup');
      }

      return { success: false, needsVerification: true, userId, email: userEmail };
    }

    const keys = await getAllKeys(['token1', 'c_user']);
    if (!keys) {
      return { success: false, error: 'Failed to generate authentication token' };
    }

    const tokenData = { c_usr: userC_usr };
    const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
    const token = await EncryptCombine(tokenData, keys, {
      expiresIn: thirtyDaysInSeconds,
      algorithm: 'HS512'
    });

    if (!token) {
      return { success: false, error: 'Failed to generate authentication token' };
    }

    return { success: true, token };
  } catch (error) {
    console.error('Error in loginUser:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
};

export const resendVerificationCode = async (userId: string, email: string, type: 'signup' | 'reset' | 'verify' = 'verify'): Promise<{ success: boolean; error?: string }> => {
  try {
    if (!db) {
      return { success: false, error: 'Database not initialized' };
    }

    const { data: user, error: userError } = await db
      .from('users')
      .select('is_memories')
      .eq('id', userId)
      .maybeSingle();

    if (userError || !user) {
      return { success: false, error: 'Invalid username/email or password' };
    }

    if (user.is_memories) {
      return { success: false, error: 'Invalid username/email or password' };
    }

    const code = generateVerificationCode();
    const codeHash = await hashVerificationCode(code);
    
    if (!codeHash) {
      return { success: false, error: 'Failed to generate verification code' };
    }

    const saved = await saveVerificationCode(userId, codeHash, 1);
    if (!saved) {
      return { success: false, error: 'Failed to save verification code' };
    }

    const emailSent = await sendEmail(email, code, type);
    if (!emailSent) {
      return { success: false, error: 'Failed to send verification email' };
    }

    return { success: true };
  } catch (error) {
    console.error('Error in resendVerificationCode:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
};

