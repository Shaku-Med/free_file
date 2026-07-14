import fs from 'node:fs';
import {
  contentTypeForFilename,
  ensureCachedInstaller,
} from '~/lib/desktop/desktopVersions.server';
import {
  checkDesktopDownloadRateLimit,
  getActiveDesktopVersionCached,
  withInstallerFetchSlot,
} from '~/lib/desktop/desktopVersionApi.server';

function jsonError(message: string, status: number, extraHeaders?: HeadersInit) {
  return Response.json(
    { success: false, error: message },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Desktop-Error': message.slice(0, 200),
        ...extraHeaders,
      },
    },
  );
}

/**
 * GET /api/desktop/win/download
 * Streams the active Windows installer. Fetches from GitHub once, then serves from disk cache.
 * On miss / failure: JSON error (never an attachment body).
 */
export async function loader({ request }: { request: Request }) {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return jsonError('Method not allowed', 405);
    }

    const limited = checkDesktopDownloadRateLimit(request);
    if (!limited.allowed) {
      return jsonError(limited.error || 'Too many downloads. Try again shortly.', 429, {
        'Retry-After': String(limited.retryAfterSec || 120),
      });
    }

    const row = await getActiveDesktopVersionCached('windows');
    if (!row) {
      return jsonError(
        "We didn't find a Windows build to download. Nothing has been published yet.",
        404,
      );
    }

    let filePath: string;
    try {
      filePath = await withInstallerFetchSlot(() => ensureCachedInstaller(row));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Download failed';
      if (/queue full|queue timeout/i.test(msg)) {
        return jsonError(
          'Too many people are downloading right now. Please try again in a moment.',
          503,
          { 'Retry-After': '30' },
        );
      }
      if (/GITHUB_WV_|not set|Failed to fetch installer/i.test(msg)) {
        return jsonError(
          "We couldn't fetch the Windows installer. Please try again later.",
          502,
        );
      }
      throw e;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return jsonError("We didn't find the installer file on the server.", 404);
    }

    if (!stat.isFile() || stat.size <= 0) {
      return jsonError("We didn't find a valid Windows installer to download.", 404);
    }

    const headers = new Headers({
      'Content-Type': contentTypeForFilename(row.filename),
      'Content-Disposition': `attachment; filename="${row.filename.replace(/"/g, '')}"`,
      'Cache-Control': 'public, max-age=3600',
      'X-Desktop-Version': row.version,
      'Accept-Ranges': 'bytes',
    });

    if (request.method === 'HEAD') {
      headers.set('Content-Length', String(stat.size));
      return new Response(null, { status: 200, headers });
    }

    const range = request.headers.get('range');
    if (range) {
      const m = /^bytes=(\d+)-(\d+)?$/.exec(range);
      if (m) {
        const start = parseInt(m[1], 10);
        const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
        if (start >= 0 && end < stat.size && start <= end) {
          headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
          headers.set('Content-Length', String(end - start + 1));
          const stream = fs.createReadStream(filePath, { start, end });
          return new Response(stream as unknown as BodyInit, { status: 206, headers });
        }
      }
    }

    headers.set('Content-Length', String(stat.size));
    const stream = fs.createReadStream(filePath);
    return new Response(stream as unknown as BodyInit, { status: 200, headers });
  } catch (e) {
    console.error('[desktop/win/download]', e);
    return jsonError('Download failed. Please try again later.', 502);
  }
}
