export interface DashPost {
  unique_id: string;
  filename: string;
  file_title: string | null;
  file_type: string;
  endpoint: string;
  duration: number | null;
  created_at: string;
  default_thumbnail: string | null;
  thumbnails: string[] | null;
  is_adult: boolean;
}

export interface LatestPost extends DashPost {
  view_count: number;
  like_count: number;
  comment_count: number;
  rank: number | null;
  rankOf: number;
  window: { days: number; views: number; typical: number | null } | null;
}

export interface DashboardResponse {
  success: boolean;
  /** False when event analytics is not set up, so views fall back to post totals. */
  analytics: boolean;
  latest: LatestPost | null;
  channel: {
    subscribers: number;
    newSubscribers28d: number;
    posts28d: number;
    views28d: number;
    viewsPrev28d: number | null;
    watchHours28d: number;
  };
  topRecent: Array<DashPost & { views: number }>;
}
