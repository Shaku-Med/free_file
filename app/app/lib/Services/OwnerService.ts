import db from '../Database/supabase';
import type { OwnerInfo } from '~/components/OwnerProfile/OwnerProfile';

export class OwnerService {
  /**
   * Enriches a single file with owner information
   */
  async enrichFileWithOwner(file: any): Promise<any> {
    if (!file?.owner_id || !db) {
      return { ...file, owner: null };
    }

    try {
      const { data: ownerData, error } = await db
        .from('users')
        .select('id, username, profile_pic')
        .eq('id', file.owner_id)
        .maybeSingle();

      if (error || !ownerData) {
        console.error(`Error fetching owner for file ${file.id}:`, error);
        return { ...file, owner: null };
      }

      return {
        ...file,
        owner: {
          id: ownerData.id,
          username: ownerData.username,
          profile_pic: ownerData.profile_pic
        } as OwnerInfo
      };
    } catch (error) {
      console.error(`Error enriching file with owner:`, error);
      return { ...file, owner: null };
    }
  }

  /**
   * Enriches multiple files with owner information in batch
   */
  async enrichFilesWithOwners(files: any[]): Promise<any[]> {
    if (!files || files.length === 0 || !db) {
      return files.map(file => ({ ...file, owner: null }));
    }

    // Get unique owner IDs
    const ownerIds = [...new Set(files.map(file => file.owner_id).filter(Boolean))];

    if (ownerIds.length === 0) {
      return files.map(file => ({ ...file, owner: null }));
    }

    try {
      // Fetch all owners in one query
      const { data: ownersData, error } = await db
        .from('users')
        .select('id, username, profile_pic')
        .in('id', ownerIds);

      if (error) {
        console.error('Error fetching owners:', error);
        return files.map(file => ({ ...file, owner: null }));
      }

      // Create a map of owner_id -> owner data
      const ownersMap = new Map(
        (ownersData || []).map((owner: any) => [
          owner.id,
          {
            id: owner.id,
            username: owner.username,
            profile_pic: owner.profile_pic
          } as OwnerInfo
        ])
      );

      // Enrich files with owner data
      return files.map(file => ({
        ...file,
        owner: file.owner_id ? ownersMap.get(file.owner_id) || null : null
      }));
    } catch (error) {
      console.error('Error enriching files with owners:', error);
      return files.map(file => ({ ...file, owner: null }));
    }
  }
}

export const ownerService = new OwnerService();

