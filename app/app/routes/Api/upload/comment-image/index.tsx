/**
 * DEPRECATED — comment images upload directly to GoUpload.
 *
 * Flow: browser → GET /api/upload/auth (mint short-lived bearer from HttpOnly
 * session cookie) → POST {GO_UPLOAD}/api/comment-image/upload
 *
 * GoUpload verifies the bearer via /api/upload-server-check, runs NSFW checks,
 * stores the file, and notifies /api/webhooks/comment-image-storage.
 */

export const action = async () => new Response(null, { status: 410 });

export const loader = async () => new Response(null, { status: 410 });
