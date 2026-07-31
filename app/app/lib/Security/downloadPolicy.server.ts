import { data } from 'react-router';

/**
 * Server side download policy. Right now nobody downloads, owners included.
 *
 * The old `/api/download*` endpoints let the OWNER of a file pull an original
 * back down. That is being withdrawn deliberately: download is meant to be an
 * explicitly authenticated action through a purpose-built endpoint, not a
 * side effect of owning a row.
 *
 * The queue implementation (lib/Services/DownloadQueue) is intentionally left
 * in the tree. Only the ROUTES are sealed, so the future endpoint can reuse the
 * machinery without it being reachable in the meantime.
 *
 * 410 rather than 404: the endpoint genuinely existed and is now withdrawn, and
 * a client that still calls it should stop rather than retry.
 */

export const DOWNLOADS_ENABLED = false;

/** Blanket refusal for every download route. */
export function downloadDisabledResponse() {
  return data(
    { error: 'Downloads are disabled', code: 'downloads_disabled' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * Guard for a download route. Returns a Response to return immediately, or
 * null when downloads are switched back on.
 *
 * Written as a fail-closed check on a constant rather than an env var on
 * purpose: a download path must not become reachable because of a typo or a
 * missing variable in one environment.
 */
export function refuseIfDownloadsDisabled() {
  return DOWNLOADS_ENABLED ? null : downloadDisabledResponse();
}
