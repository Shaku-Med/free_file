import crypto from 'crypto';
import bcrypt from 'bcrypt';
import db from '~/lib/Database/supabase';

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

