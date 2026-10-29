// The feed's filter chips, on Home and Posts. Values must match the category
// strings stored on files: the feed RPC matches f.categories @> the value exactly.
export const FEED_CATEGORIES = [
  "Music", "Gaming", "Entertainment", "Education", "Technology", "Sports",
  "News", "Lifestyle", "Anime", "Film", "Automotive", "Art", "Nature",
] as const;
