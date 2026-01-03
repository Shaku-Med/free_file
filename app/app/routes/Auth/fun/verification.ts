import crypto from 'crypto';
import bcrypt from 'bcrypt';
import db from '~/lib/Database/supabase';
import { EncryptCombine, DecryptCombine } from '~/lib/Security/unsharedkeyEncryption/Combined/Combined';
import { getAllKeys, extractTokenHeaders } from '~/lib/Security/unsharedkeyEncryption/Combined/Verification/TokenKeys';
import { getClientIP } from '~/lib/Security/unsharedkeyEncryption/Combined/Verification/GetIp';

export const generateVerificationCode = (): string => {
  return crypto.randomInt(100000, 999999).toString();
};

export const hashVerificationCode = async (code: string): Promise<string | null> => {
  try {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(code, salt);
    return hash;
  } catch (error) {
    console.error('Error hashing verification code:', error);
    return null;
  }
};

export const verifyCode = async (code: string, codeHash: string): Promise<boolean> => {
  try {
    return await bcrypt.compare(code, codeHash);
  } catch (error) {
    console.error('Error verifying code:', error);
    return false;
  }
};

export const saveVerificationCode = async (
  userId: string,
  codeHash: string,
  expiresInDays: number = 1
): Promise<boolean> => {
  try {
    if (!db) return false;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const { data: existingRecord } = await db
      .from('verification')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (existingRecord) {
      const { error: updateError } = await db
        .from('verification')
        .update({
          code_hash: codeHash,
          expires_at: expiresAt.toISOString()
        })
        .eq('user_id', userId);

      if (updateError) {
        console.error('Error updating verification code:', updateError);
        return false;
      }
    } else {
      const { error: insertError } = await db
        .from('verification')
        .insert({
          user_id: userId,
          code_hash: codeHash,
          expires_at: expiresAt.toISOString()
        });

      if (insertError) {
        console.error('Error inserting verification code:', insertError);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error('Error in saveVerificationCode:', error);
    return false;
  }
};

export const getVerificationRecord = async (userId: string) => {
  try {
    if (!db) return null;

    const { data, error } = await db
      .from('verification')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error getting verification record:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in getVerificationRecord:', error);
    return null;
  }
};

export const isVerificationCodeExpired = (expiresAt: string | null): boolean => {
  if (!expiresAt) return true;
  return new Date(expiresAt) < new Date();
};

export const deleteVerificationRecord = async (userId: string): Promise<boolean> => {
  try {
    if (!db) return false;

    const { error } = await db
      .from('verification')
      .delete()
      .eq('user_id', userId);

    if (error) {
      console.error('Error deleting verification record:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in deleteVerificationRecord:', error);
    return false;
  }
};

export const generateResetToken = async (userId: string, headers: Headers): Promise<string | null> => {
  try {
    if (!db) {
      return null;
    }

    // Get email from database using userId - never trust email from client
    const { data: user, error: userError } = await db
      .from('users')
      .select('email, is_memories')
      .eq('id', userId)
      .maybeSingle();

    if (userError || !user || user.is_memories) {
      return null;
    }

    const email = user.email;

    const nonce = crypto.randomBytes(32).toString('hex');
    const timestamp = Date.now();
    const ip = await getClientIP(headers);
    const deviceHeaders = await extractTokenHeaders(headers);
    
    let ipString: string | null = null;
    if (typeof ip === 'string') {
      ipString = ip;
    } else if (ip === true) {
      const forwardedFor = headers.get('x-forwarded-for')?.split(',')[0].trim();
      ipString = forwardedFor || null;
    }

    if (!ipString || (ipString === 'unknown' && process.env.NODE_ENV === 'production')) {
      if (process.env.NODE_ENV === 'production') {
        return null;
      }
      ipString = '::1';
    }

    const deviceFingerprint = {
      ip: ipString,
      userAgent: deviceHeaders['user-agent'] || '',
      platform: deviceHeaders['sec-ch-ua-platform'] || ''
    };

    const deviceFingerprintHash = await hashVerificationCode(JSON.stringify(deviceFingerprint));
    if (!deviceFingerprintHash) {
      return null;
    }

    const tokenData = {
      userId,
      email,
      nonce,
      timestamp,
      type: 'password_reset'
    };

    const keys = await getAllKeys(['password']);
    if (!keys) {
      return null;
    }

    const expiresIn = 15 * 60;
    const token = await EncryptCombine(tokenData, keys, {
      expiresIn,
      algorithm: 'HS512'
    });

    if (!token) {
      return null;
    }

    const tokenHash = await hashVerificationCode(token);
    if (!tokenHash) {
      return null;
    }

    if (!db) return null;

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15);

    const combinedHash = `${tokenHash}:${deviceFingerprintHash}`;

    const { data: existingRecord } = await db
      .from('verification')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (existingRecord) {
      const { error: updateError } = await db
        .from('verification')
        .update({
          code_hash: combinedHash,
          expires_at: expiresAt.toISOString()
        })
        .eq('user_id', userId);

      if (updateError) {
        console.error('Error saving reset token:', updateError);
        return null;
      }
    } else {
      const { error: insertError } = await db
        .from('verification')
        .insert({
          user_id: userId,
          code_hash: combinedHash,
          expires_at: expiresAt.toISOString()
        });

      if (insertError) {
        console.error('Error saving reset token:', insertError);
        return null;
      }
    }

    return token;
  } catch (error) {
    console.error('Error generating reset token:', error);
    return null;
  }
};

export const validateResetToken = async (token: string, headers: Headers): Promise<{ userId: string; email: string } | null> => {
  try {
    if (!token) return null;

    const keys = await getAllKeys(['password']);
    if (!keys) {
      return null;
    }

    const decrypted = await DecryptCombine(token, keys, {
      algorithm: 'HS512'
    });

    if (!decrypted || typeof decrypted !== 'object') {
      return null;
    }

    if (decrypted.type !== 'password_reset') {
      return null;
    }

    if (!decrypted.userId || !decrypted.email) {
      return null;
    }

    if (!db) return null;

    const { data: tokenRecord, error: tokenError } = await db
      .from('verification')
      .select('*')
      .eq('user_id', decrypted.userId)
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tokenError || !tokenRecord) {
      return null;
    }

    const storedHash = tokenRecord.code_hash as string;
    if (!storedHash || !storedHash.includes(':')) {
      return null;
    }

    const [storedTokenHash, storedDeviceFingerprintHash] = storedHash.split(':');
    
    const isValidToken = await verifyCode(token, storedTokenHash);
    if (!isValidToken) {
      return null;
    }

    if (isVerificationCodeExpired(tokenRecord.expires_at)) {
      return null;
    }

    const currentIp = await getClientIP(headers);
    const currentDeviceHeaders = await extractTokenHeaders(headers);

    let currentIpString: string | null = null;
    if (typeof currentIp === 'string') {
      currentIpString = currentIp;
    } else if (currentIp === true) {
      const forwardedFor = headers.get('x-forwarded-for')?.split(',')[0].trim();
      currentIpString = forwardedFor || null;
    }

    if (!currentIpString || (currentIpString === 'unknown' && process.env.NODE_ENV === 'production')) {
      if (process.env.NODE_ENV === 'production') {
        return null;
      }
      currentIpString = '::1';
    }

    const currentDeviceFingerprint = {
      ip: currentIpString,
      userAgent: currentDeviceHeaders['user-agent'] || '',
      platform: currentDeviceHeaders['sec-ch-ua-platform'] || ''
    };

    const isValidDevice = await verifyCode(JSON.stringify(currentDeviceFingerprint), storedDeviceFingerprintHash);
    if (!isValidDevice) {
      return null;
    }

    const { data: user, error } = await db
      .from('users')
      .select('id, email, is_memories')
      .eq('id', decrypted.userId)
      .eq('email', decrypted.email)
      .maybeSingle();

    if (error || !user || user.is_memories) {
      return null;
    }

    return {
      userId: decrypted.userId,
      email: decrypted.email
    };
  } catch (error) {
    console.error('Error validating reset token:', error);
    return null;
  }
};

export const markResetTokenAsUsed = async (userId: string): Promise<boolean> => {
  try {
    if (!db) return false;

    const { error } = await db
      .from('verification')
      .delete()
      .eq('user_id', userId);

    if (error) {
      console.error('Error marking reset token as used:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error marking reset token as used:', error);
    return false;
  }
};

