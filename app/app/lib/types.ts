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
  /** Series hub video (playlist root). */
  is_series_main?: boolean;
  /** Episode row; API/DB may use `is_files_series_item` instead. */
  is_series_episode?: boolean;
  is_files_series_item?: boolean;
  duration?: number;
  engagement_score?: number;
  comments_enabled?: boolean;
  /** null/undefined = unlimited; 0 = no comments allowed; positive = max visible comments */
  comment_limit?: number | null;
}

/** Episodes returned for a series main file on the dynamic page */
export interface SeriesEpisodeGroup {
  episode_id: string;
  episode_name: string;
  episode_number: number | null;
  items: FileType[];
}

export interface PageCacheData {
  data: unknown;
  currentPageNumber: number;
  nextPageNumber: number;
  totalPages: number;
  hasMore: boolean;
}

export type PageCacheEntry = Array<Record<string, PageCacheData>>;