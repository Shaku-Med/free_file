import {
  compareSemver,
  mapElectronPlatform,
} from '~/lib/desktop/desktopVersions.server';
import {
  assertDesktopVersionRequest,
  checkDesktopVersionRateLimit,
  getActiveDesktopVersionCached,
  sanitizeCurrentVersion,
} from '~/lib/desktop/desktopVersionApi.server';

/**
 * GET /api/desktop/version?platform=win32&current=1.0.0
 * Returns whether a newer active desktop build exists (remote > current).
 * Cached in-process (90s TTL + single-flight) so traffic does not hammer the DB.
 */
export async function loader({ request }: { request: Request }) {
  try {
    const bad = assertDesktopVersionRequest(request);
    if (bad) return bad;

    const limited = checkDesktopVersionRateLimit(request);
    if (!limited.allowed) {
      return Response.json(
        { success: false, error: limited.error || 'Too many requests' },
        {
          status: 429,
          headers: {
            'Retry-After': String(limited.retryAfterSec || 60),
            'Cache-Control': 'no-store',
          },
        },
      );
    }

    const url = new URL(request.url);
    const platformRaw = url.searchParams.get('platform') || 'win32';
    const current = sanitizeCurrentVersion(url.searchParams.get('current') || '0.0.0');
    const platform = mapElectronPlatform(platformRaw);

    if (!platform) {
      return Response.json({ success: false, error: 'Unsupported platform' }, { status: 400 });
    }

    const row = await getActiveDesktopVersionCached(platform);
    if (!row) {
      return Response.json(
        {
          success: true,
          updateAvailable: false,
          platform,
          current,
          latest: null,
        },
        {
          headers: {
            'Cache-Control': 'public, max-age=60, stale-while-revalidate=120',
          },
        },
      );
    }

    const newer = compareSemver(row.version, current) > 0;
    return Response.json(
      {
        success: true,
        updateAvailable: newer,
        platform,
        current,
        latest: {
          version: row.version,
          filename: row.filename,
          notes: row.notes,
          // Client downloads through our cached API — never a raw GitHub URL.
          downloadPath:
            platform === 'windows'
              ? '/api/desktop/win/download'
              : platform === 'mac'
                ? '/api/desktop/mac/download'
                : '/api/desktop/linux/download',
        },
      },
      {
        headers: {
          // Short CDN/browser cache; server memory cache is the main DB shield.
          'Cache-Control': 'public, max-age=60, stale-while-revalidate=120',
          'X-Desktop-Latest': row.version,
        },
      },
    );
  } catch (e) {
    console.error('[desktop/version]', e);
    const msg = e instanceof Error && e.message === 'Database unavailable'
      ? 'Database unavailable'
      : 'Server error';
    return Response.json(
      { success: false, error: msg },
      { status: msg === 'Database unavailable' ? 503 : 500 },
    );
  }
}
