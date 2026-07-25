import crypto from 'crypto';
import bcrypt from 'bcrypt';
import db from '~/lib/Database/supabase';
import { EncryptCombine, DecryptCombine } from '~/lib/Security/unsharedkeyEncryption/Combined/Combined';
import { getAllKeys, extractTokenHeaders } from '~/lib/Security/unsharedkeyEncryption/Combined/Verification/TokenKeys';
import { getClientIP } from '~/lib/Security/unsharedkeyEncryption/Combined/Verification/GetIp';
import { getCookie } from '~/lib/Security/Token';

// Signed, HttpOnly flow context for /auth/verify. The userId is carried here
// instead of the URL so an attacker can't target an arbitrary account by
// editing ?userId=. Issued only when a flow legitimately starts (signup /
// login-needs-verify / reset request).
const VERIFY_CTX_COOKIE = 'verify_ctx';
const VERIFY_CTX_TTL_SEC = 30 * 60;
export type VerifyFlow = 'signup' | 'reset';

export async function issueVerifyContext(userId: string, type: VerifyFlow): Promise<string | null> {
  if (!userId) return null;
  const keys = await getAllKeys(['temp_token']);
  if (!keys) return null;
  return EncryptCombine({ userId, type, ctx: 'verify' }, keys, {
    expiresIn: VERIFY_CTX_TTL_SEC,
    algorithm: 'HS512',
  });
}

export async function readVerifyContext(
  request: Request
): Promise<{ userId: string; type: VerifyFlow } | null> {
  const token = getCookie(VERIFY_CTX_COOKIE, request.headers);
  if (!token) return null;
  const keys = await getAllKeys(['temp_token']);
  if (!keys) return null;
  const decoded = await DecryptCombine(token, keys, { algorithm: 'HS512' });
  if (!decoded || typeof decoded !== 'object') return null;
  if (decoded.ctx !== 'verify' || !decoded.userId) return null;
  if (decoded.type !== 'signup' && decoded.type !== 'reset') return null;
  return { userId: String(decoded.userId), type: decoded.type };
}

export function appendVerifyContextCookie(headers: Headers, token: string): void {
  const secure = process.env.NODE_ENV === 'production' ? 'Secure' : '';
  headers.append(
    'Set-Cookie',
    `${VERIFY_CTX_COOKIE}=${token}; Path=/; Max-Age=${VERIFY_CTX_TTL_SEC}; HttpOnly; ${secure}; SameSite=Lax`
  );
}

export function clearVerifyContextCookie(headers: Headers): void {
  const secure = process.env.NODE_ENV === 'production' ? 'Secure' : '';
  headers.append(
    'Set-Cookie',
    `${VERIFY_CTX_COOKIE}=; Path=/; Max-Age=0; HttpOnly; ${secure}; SameSite=Lax`
  );
}

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

/**
 * SHA-256 hex digest.
 *
 * Used for the reset token and the device fingerprint instead of bcrypt.
 * bcrypt SILENTLY TRUNCATES its input at 72 bytes, and both of those values are
 * far longer — a JWT, and `{"ip":...,"userAgent":...,"platform":...}` where a
 * normal User-Agent alone blows the limit. The result was that the device bind
 * only ever compared the first 72 characters (platform never compared at all),
 * and the token bind covered the JWT header rather than its signature.
 *
 * These inputs are high-entropy and not user-chosen secrets, so a fast digest
 * is the right primitive; bcrypt's work factor buys nothing here. Low-entropy
 * 6-digit codes above still use bcrypt, which is correct for them.
 */
export const sha256Hex = (value: string): string =>
  crypto.createHash('sha256').update(value, 'utf8').digest('hex');

/** Length-checked constant-time compare for hex digests. */
export const timingSafeHexEqual = (a: unknown, b: unknown): boolean => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length || a.length === 0) return false;
  try {
    // timingSafeEqual throws on length mismatch, hence the guard above.
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
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

    // Delete + insert so a re-issued code starts with a fresh attempts
    // counter (column DEFAULT 0). Avoids depending on the column existing
    // in the write payload.
    await db.from('verification').delete().eq('user_id', userId);

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

    return true;
  } catch (error) {
    console.error('Error in saveVerificationCode:', error);
    return false;
  }
};

/** Increment failed-attempt counter for a code. Returns the new count (or null). */
export const incrementVerificationAttempts = async (userId: string): Promise<number | null> => {
  try {
    if (!db) return null;
    const { data, error } = await db.rpc('increment_verification_attempts', { p_user_id: userId });
    if (error) {
      console.error('Error incrementing verification attempts:', error);
      return null;
    }
    const n = typeof data === 'number' ? data : Number(data);
    return Number.isFinite(n) ? n : null;
  } catch (error) {
    console.error('Error in incrementVerificationAttempts:', error);
    return null;
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

    const deviceFingerprintHash = sha256Hex(JSON.stringify(deviceFingerprint));

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

    const tokenHash = sha256Hex(token);

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

    // Constant-time compare of the FULL token digest. (Previously a bcrypt
    // compare that only covered the first 72 bytes of the JWT.)
    if (!timingSafeHexEqual(sha256Hex(token), storedTokenHash)) {
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

    // Full-fingerprint compare — ip + user-agent + platform all actually count
    // now, instead of only the first 72 bytes of the JSON.
    if (
      !timingSafeHexEqual(
        sha256Hex(JSON.stringify(currentDeviceFingerprint)),
        storedDeviceFingerprintHash,
      )
    ) {
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

