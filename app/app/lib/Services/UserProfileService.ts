import db from '../Database/supabase';
import type { FileType } from '../types';

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  profile_pic: string;
  created_at: string;
  verified: boolean;
  about: string | null;
  file_count?: number;
}

export interface UserProfileResponse<T> {
  data: T | null;
  error: string | null;
}

export class UserProfileService {
  async getUserProfile(userId: string): Promise<UserProfileResponse<UserProfile>> {
    try {
      if (!db) {
        return { data: null, error: 'Database not initialized' };
      }

      const { data, error } = await db
        .from('users')
        .select('id, username, email, profile_pic, created_at, verified, about')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('Error fetching user profile:', error);
        return { data: null, error: 'Failed to fetch user profile' };
      }

      if (!data) {
        return { data: null, error: 'User not found' };
      }

      const fileCountResult = await this.getUserFileCount(userId);
      const fileCount = fileCountResult.data || 0;

      return {
        data: {
          ...data,
          file_count: fileCount
        },
        error: null
      };
    } catch (error) {
      console.error('Error in getUserProfile:', error);
      return { data: null, error: 'Internal server error' };
    }
  }

  async getUserProfileByUsername(username: string): Promise<UserProfileResponse<UserProfile>> {
    try {
      if (!db) {
        return { data: null, error: 'Database not initialized' };
      }

      const { data, error } = await db
        .from('users')
        .select('id, username, email, profile_pic, created_at, verified, about')
        .eq('username', username)
        .maybeSingle();

      if (error) {
        console.error('Error fetching user profile by username:', error);
        return { data: null, error: 'Failed to fetch user profile' };
      }

      if (!data) {
        return { data: null, error: 'User not found' };
      }

      const fileCountResult = await this.getUserFileCount(data.id);
      const fileCount = fileCountResult.data || 0;

      return {
        data: {
          ...data,
          file_count: fileCount
        },
        error: null
      };
    } catch (error) {
      console.error('Error in getUserProfileByUsername:', error);
      return { data: null, error: 'Internal server error' };
    }
  }

  async getUserFiles(
    userId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<UserProfileResponse<FileType[]>> {
    try {
      if (!db) {
        return { data: null, error: 'Database not initialized' };
      }

      const { data, error } = await db
        .from('files')
        .select('*')
        .eq('owner_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error('Error fetching user files:', error);
        return { data: null, error: 'Failed to fetch user files' };
      }

      return { data: data || [], error: null };
    } catch (error) {
      console.error('Error in getUserFiles:', error);
      return { data: null, error: 'Internal server error' };
    }
  }

  private async getUserFileCount(userId: string): Promise<UserProfileResponse<number>> {
    try {
      if (!db) {
        return { data: null, error: 'Database not initialized' };
      }

      const { count, error } = await db
        .from('files')
        .select('*', { count: 'exact', head: true })
        .eq('owner_id', userId);

      if (error) {
        console.error('Error counting user files:', error);
        return { data: null, error: 'Failed to count user files' };
      }

      return { data: count || 0, error: null };
    } catch (error) {
      console.error('Error in getUserFileCount:', error);
      return { data: null, error: 'Internal server error' };
    }
  }
}

export const userProfileService = new UserProfileService();

