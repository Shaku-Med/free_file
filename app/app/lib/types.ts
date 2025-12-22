import type { OwnerInfo } from '~/components/OwnerProfile/OwnerProfile';

export interface FileType {
  id: string;
  created_at: string;
  endpoint: string;
  filename: string;
  unique_id: string;
  file_type: string;
  file_size: string | number;
  is_adult?: boolean;
  up_count?: number;
  down_count?: number;
  views?: number;
  view_count?: number;
  shares?: number;
  share_count?: number;
  owner_id?: string;
  owner?: OwnerInfo | null;
  is_public?: boolean;
  file_description?: string;
  category?: unknown[];
  file_title?: string;
  thumbnails?: string[];
}