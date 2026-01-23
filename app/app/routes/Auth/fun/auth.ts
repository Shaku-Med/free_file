import db from '~/lib/Database/supabase';
import { PasswordHash, CreatePassword, VerifyPassword } from '~/lib/Security/Password';
import { generateVerificationCode, hashVerificationCode, saveVerificationCode } from './verification';
import { sendVerificationEmail as sendEmail } from './email';
import { EncryptCombine } from '~/lib/Security/unsharedkeyEncryption/Combined/Combined';
import { getAllKeys } from '~/lib/Security/unsharedkeyEncryption/Combined/Verification/TokenKeys';
import { validateSignupInputs, validateLoginInputs, normalizeIdentifier, constantTimeDelay } from './validation';

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
    // Validate and sanitize inputs
    const validation = validateSignupInputs(data);
    if (!validation.valid) {
      return { success: false, error: validation.errors[0] || 'Invalid input' };
    }

    const sanitized = validation.sanitized!;

    if (!db) {
      return { success: false, error: 'An error occurred. Please try again later.' };
    }

    // Check for existing email (prevent account enumeration by using same error message)
    const { data: emailUser, error: emailError } = await db
      .from('users')
      .select('id, is_memories')
      .eq('email', sanitized.email)
      .maybeSingle();

    if (emailError) {
      console.error('Error checking existing email:', emailError);
      // Add delay to prevent timing attacks
      await constantTimeDelay();
      return { success: false, error: 'An error occurred. Please try again later.' };
    }

    if (emailUser) {
      if (emailUser.is_memories) {
        await constantTimeDelay();
        return { success: false, error: 'An error occurred. Please try again later.' };
      }
      await constantTimeDelay();
      return { success: false, error: 'An account with this email or username already exists' };
    }

    // Check for existing username (prevent account enumeration)
    const { data: usernameUser, error: usernameError } = await db
      .from('users')
      .select('id, is_memories')
      .eq('username', sanitized.username)
      .maybeSingle();

    if (usernameError) {
      console.error('Error checking existing username:', usernameError);
      await constantTimeDelay();
      return { success: false, error: 'An error occurred. Please try again later.' };
    }

    if (usernameUser) {
      if (usernameUser.is_memories) {
        await constantTimeDelay();
        return { success: false, error: 'An error occurred. Please try again later.' };
      }
      await constantTimeDelay();
      return { success: false, error: 'An account with this email or username already exists' };
    }

    const unverifiedExpire = new Date();
    unverifiedExpire.setDate(unverifiedExpire.getDate() + 2);

    const { data: user, error } = await db
      .from('users')
      .insert({
        username: sanitized.username,
        email: sanitized.email,
        dob: sanitized.dob,
        verified: false,
        unverified_expire: unverifiedExpire.toISOString()
      })
      .select('id')
      .single();

    if (error || !user) {
      console.error('Error creating user:', error);
      await constantTimeDelay();
      return { success: false, error: 'An error occurred. Please try again later.' };
    }

    const passwordHash = await CreatePassword(sanitized.password);
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

    const emailSent = await sendEmail(sanitized.email, code, 'signup');
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
    // Validate inputs
    const validation = validateLoginInputs(data);
    if (!validation.valid) {
      await constantTimeDelay(); // Prevent timing attacks
      return { success: false, error: 'Invalid username/email or password' };
    }

    const sanitized = validation.sanitized!;
    const normalizedIdentifier = normalizeIdentifier(sanitized.identifier);

    if (!db) {
      await constantTimeDelay();
      return { success: false, error: 'Invalid username/email or password' };
    }

    const isEmail = normalizedIdentifier.includes('@');
    let userId: string | null = null;
    let userEmail: string | null = null;
    let userC_usr: string | null = null;
    let isVerified: boolean = false;
    let isMemories: boolean = false;

    // Efficient lookup - use database query instead of fetching all users
    if (isEmail) {
      const { data: userData, error } = await db
        .from('users')
        .select('id, email, username, c_usr, verified, is_memories')
        .eq('email', normalizedIdentifier)
        .maybeSingle();

      if (!error && userData && !userData.is_memories) {
        userId = userData.id;
        userEmail = userData.email;
        userC_usr = userData.c_usr;
        isVerified = userData.verified;
        isMemories = userData.is_memories;
      }
    } else {
      // Use database query for username lookup instead of fetching all users
      const { data: userData, error } = await db
        .from('users')
        .select('id, email, username, c_usr, verified, is_memories')
        .eq('username', normalizedIdentifier)
        .maybeSingle();

      if (!error && userData && !userData.is_memories) {
        userId = userData.id;
        userEmail = userData.email;
        userC_usr = userData.c_usr;
        isVerified = userData.verified;
        isMemories = userData.is_memories;
      }
    }

    // Always perform password verification to prevent timing attacks
    // Use a dummy hash if user not found
    let passwordHash: string | null = null;
    if (userId) {
      const { data: passwordData, error: passwordError } = await db
        .from('passwords')
        .select('password')
        .eq('id', userId)
        .maybeSingle();

      if (!passwordError && passwordData) {
        passwordHash = passwordData.password;
      }
    }

    // Always verify password (even with dummy) to prevent timing attacks
    let isValid = false;
    if (passwordHash) {
      isValid = await VerifyPassword(sanitized.password, passwordHash) || false;
    } else {
      // Verify against dummy hash to maintain constant time
      const dummyHash = '$2b$10$dummy.hash.for.timing.attack.protection';
      await VerifyPassword('dummy', dummyHash);
    }

    // Add constant delay regardless of outcome
    await constantTimeDelay(100);

    if (!userId || !isValid || isMemories) {
      return { success: false, error: 'Invalid username/email or password' };
    }

    if (!isVerified) {
      const code = generateVerificationCode();
      const codeHash = await hashVerificationCode(code);
      
      if (codeHash && userEmail) {
        await saveVerificationCode(userId, codeHash, 1);
        await sendEmail(userEmail, code, 'signup');
      }

      return { success: false, needsVerification: true, userId, email: userEmail! };
    }

    const keys = await getAllKeys(['token1', 'c_user']);
    if (!keys) {
      return { success: false, error: 'Failed to generate authentication token' };
    }

    if (!userC_usr) {
      return { success: false, error: 'Invalid username/email or password' };
    }

    const tokenData = { c_usr: userC_usr };
    // const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
    const token = await EncryptCombine(tokenData, keys, {
      expiresIn: '365d',
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

export const resendVerificationCode = async (userId: string, type: 'signup' | 'reset' | 'verify' = 'verify'): Promise<{ success: boolean; error?: string }> => {
  try {
    if (!db) {
      return { success: false, error: 'Database not initialized' };
    }

    // Get email from database using userId - never trust email from client
    const { data: user, error: userError } = await db
      .from('users')
      .select('email, is_memories')
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

    // Send email to the email address from database, not from client
    const emailSent = await sendEmail(user.email, code, type);
    if (!emailSent) {
      return { success: false, error: 'Failed to send verification email' };
    }

    return { success: true };
  } catch (error) {
    console.error('Error in resendVerificationCode:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
};

