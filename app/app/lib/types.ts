import type { OwnerInfo } from '~/components/OwnerProfile/OwnerProfile';

export interface SeriesType {
  id: string;
  unique_id: string;
  owner_id: string;
  title: string;
  description?: string | null;
  thumbnail_url?: string | null;
  is_public: boolean;
  created_at: string;
  updated_at?: string;
  episode_count?: number;
}

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
  like_count?: number;
  dislike_count?: number;
  comment_count?: number;
  views?: number;
  view_count?: number;
  shares?: number;
  share_count?: number;
  owner_id?: string;
  owner?: OwnerInfo | null;
  is_public?: boolean;
  file_description?: string;
  category?: string[];
  categories?: string[];
  tags?: string[];
  colors?: unknown;
  metadata?: unknown;
  file_title?: string;
  thumbnails?: string[];
  default_thumbnail?: string | null;
  upload_status?: string;
  is_reel?: boolean;
  duration?: number;
  engagement_score?: number;
  comments_enabled?: boolean;
  /** null/undefined = unlimited; 0 = no comments allowed; positive = max visible comments */
  comment_limit?: number | null;
  series_id?: string | null;
  season_number?: number | null;
  episode_number?: number | null;
  is_series_main?: boolean;
  series?: Pick<SeriesType, 'id' | 'unique_id' | 'title'> | null;
}

export interface PageCacheData {
  data: unknown;
  currentPageNumber: number;
  nextPageNumber: number;
  totalPages: number;
  hasMore: boolean;
}

export type PageCacheEntry = Array<Record<string, PageCacheData>>;