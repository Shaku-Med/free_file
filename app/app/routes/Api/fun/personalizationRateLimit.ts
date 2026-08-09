import { rateLimiter, RateLimiter } from '~/routes/Auth/fun/rateLimit';

/** Watch-time pings (one-time playback token per submission). Increased headroom vs legacy. */
const WATCH_TIME_MAX = 420;
const WATCH_TIME_WINDOW_MS = 60 * 1000;
const WATCH_TIME_BLOCK_MS = 5 * 60 * 1000;

const SAVES_POST_MAX = 60;
const SAVES_POST_WINDOW_MS = 60 * 1000;
const SAVES_POST_BLOCK_MS = 5 * 60 * 1000;

const SAVES_GET_MAX = 120;
const SAVES_GET_WINDOW_MS = 60 * 1000;
const SAVES_GET_BLOCK_MS = 5 * 60 * 1000;

const FEED_SIGNALS_POST_MAX = 40;
const FEED_SIGNALS_POST_WINDOW_MS = 60 * 1000;
const FEED_SIGNALS_POST_BLOCK_MS = 15 * 60 * 1000;

const FEED_SIGNALS_GET_MAX = 60;
const FEED_SIGNALS_GET_WINDOW_MS = 60 * 1000;
const FEED_SIGNALS_GET_BLOCK_MS = 5 * 60 * 1000;

/** Heavy RPC: recompute interests + creator affinity. */
const PERSONALIZATION_MAX = 8;
const PERSONALIZATION_WINDOW_MS = 15 * 60 * 1000;
const PERSONALIZATION_BLOCK_MS = 30 * 60 * 1000;

export function checkWatchTimeRateLimit(request: Request, userId: string) {
  const key = userId || `ip:${RateLimiter.getClientIP(request)}`;
  return rateLimiter.checkLimit(key, 'api-watch-time', WATCH_TIME_MAX, WATCH_TIME_WINDOW_MS, WATCH_TIME_BLOCK_MS);
}

const WATCH_ISSUE_MAX = 90;

/** In-memory playback token mint endpoint (paired with `/api/views/watch-time`). */
export function checkWatchIssueRateLimit(request: Request, userId: string) {
  const key = userId || `ip:${RateLimiter.getClientIP(request)}`;
  return rateLimiter.checkLimit(key, 'api-watch-issue', WATCH_ISSUE_MAX, WATCH_TIME_WINDOW_MS, WATCH_TIME_BLOCK_MS);
}

export function checkSavesPostRateLimit(request: Request, userId: string) {
  const key = userId || `ip:${RateLimiter.getClientIP(request)}`;
  return rateLimiter.checkLimit(key, 'api-saves-post', SAVES_POST_MAX, SAVES_POST_WINDOW_MS, SAVES_POST_BLOCK_MS);
}

export function checkSavesGetRateLimit(request: Request, userId: string) {
  const key = userId || `ip:${RateLimiter.getClientIP(request)}`;
  return rateLimiter.checkLimit(key, 'api-saves-get', SAVES_GET_MAX, SAVES_GET_WINDOW_MS, SAVES_GET_BLOCK_MS);
}

export function checkFeedSignalsPostRateLimit(request: Request, userId: string) {
  const key = userId || `ip:${RateLimiter.getClientIP(request)}`;
  return rateLimiter.checkLimit(
    key,
    'api-feed-signals-post',
    FEED_SIGNALS_POST_MAX,
    FEED_SIGNALS_POST_WINDOW_MS,
    FEED_SIGNALS_POST_BLOCK_MS,
  );
}

export function checkFeedSignalsGetRateLimit(request: Request, userId: string) {
  const key = userId || `ip:${RateLimiter.getClientIP(request)}`;
  return rateLimiter.checkLimit(
    key,
    'api-feed-signals-get',
    FEED_SIGNALS_GET_MAX,
    FEED_SIGNALS_GET_WINDOW_MS,
    FEED_SIGNALS_GET_BLOCK_MS,
  );
}

// Owner video list/search (powers the series "add video" picker). Each fetch is
// a DB read, so cap per user/IP to stop a held key or scripted client from
// flooding it. Generous enough for debounced typing + browsing.
const OWNER_VIDEOS_MAX = 60;
const OWNER_VIDEOS_WINDOW_MS = 60 * 1000;
const OWNER_VIDEOS_BLOCK_MS = 5 * 60 * 1000;

export function checkOwnerVideosRateLimit(request: Request, userId?: string | null) {
  const key = userId || `ip:${RateLimiter.getClientIP(request)}`;
  return rateLimiter.checkLimit(
    key,
    'api-owner-videos',
    OWNER_VIDEOS_MAX,
    OWNER_VIDEOS_WINDOW_MS,
    OWNER_VIDEOS_BLOCK_MS,
  );
}

// Interactions (like / dislike toggles): cheap but write to the DB and can be
// scripted to manipulate counts or storm writes. Generous for normal use.
const INTERACTION_MAX = 100;
const INTERACTION_WINDOW_MS = 60 * 1000;
const INTERACTION_BLOCK_MS = 5 * 60 * 1000;

export function checkInteractionRateLimit(request: Request, userId: string) {
  const key = userId || `ip:${RateLimiter.getClientIP(request)}`;
  return rateLimiter.checkLimit(
    key,
    'api-interaction',
    INTERACTION_MAX,
    INTERACTION_WINDOW_MS,
    INTERACTION_BLOCK_MS,
  );
}

// Posting comments: each is a stored write + notifications/push. Cap to stop
// comment-flooding / spam.
const COMMENT_POST_MAX = 20;
const COMMENT_POST_WINDOW_MS = 60 * 1000;
const COMMENT_POST_BLOCK_MS = 10 * 60 * 1000;

export function checkCommentPostRateLimit(request: Request, userId: string) {
  const key = userId || `ip:${RateLimiter.getClientIP(request)}`;
  return rateLimiter.checkLimit(
    key,
    'api-comment-post',
    COMMENT_POST_MAX,
    COMMENT_POST_WINDOW_MS,
    COMMENT_POST_BLOCK_MS,
  );
}

// Comment reads: stop guest scrapers walking every parentId / fileId.
const COMMENT_GET_MAX = 60;
const COMMENT_GET_WINDOW_MS = 60 * 1000;
const COMMENT_GET_BLOCK_MS = 5 * 60 * 1000;

export function checkCommentGetRateLimit(request: Request, userId?: string | null) {
  const key = userId || `ip:${RateLimiter.getClientIP(request)}`;
  return rateLimiter.checkLimit(
    key,
    'api-comment-get',
    COMMENT_GET_MAX,
    COMMENT_GET_WINDOW_MS,
    COMMENT_GET_BLOCK_MS,
  );
}

export function checkPersonalizationRateLimit(request: Request, userId: string) {
  const key = userId || `ip:${RateLimiter.getClientIP(request)}`;
  return rateLimiter.checkLimit(
    key,
    'api-personalization-refresh',
    PERSONALIZATION_MAX,
    PERSONALIZATION_WINDOW_MS,
    PERSONALIZATION_BLOCK_MS,
  );
}
