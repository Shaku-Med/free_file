/**
 * Desktop release helpers: semver compare, GitHub release download URL, disk cache.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export type DesktopPlatform = 'windows' | 'mac' | 'linux';

export type DesktopVersionRow = {
  id: string;
  platform: DesktopPlatform;
  version: string;
  endpoint: string;
  github_repo: string;
  release_tag: string;
  filename: string;
  active: boolean;
  notes: string | null;
};

/** Parse "1.2.3" / "v1.2.3" into [major, minor, patch]. */
export function parseSemver(v: string): [number, number, number] {
  const clean = String(v || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[+-]/)[0];
  const parts = clean.split('.').map((p) => {
    const n = parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/** -1 if a < b, 0 if equal, 1 if a > b. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

export function mapElectronPlatform(platform: string): DesktopPlatform | null {
  const p = platform.toLowerCase();
  if (p === 'win32' || p === 'windows' || p === 'win') return 'windows';
  if (p === 'darwin' || p === 'mac' || p === 'macos' || p === 'osx') return 'mac';
  if (p === 'linux') return 'linux';
  return null;
}

export function githubWvOwner(): string {
  return (process.env.GITHUB_WV_OWNER || '').trim();
}

export function githubWvToken(): string {
  return (process.env.GITHUB_WV_TOKEN || '').trim();
}

/** Public browser download URL for a release asset (works for public repos). */
export function githubReleaseAssetUrl(
  owner: string,
  repo: string,
  releaseTag: string,
  filename: string,
): string {
  return `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(releaseTag)}/${encodeURIComponent(filename)}`;
}

/** API download URL (works with a token for private repos). */
export function githubReleaseAssetApiUrl(
  owner: string,
  repo: string,
  releaseTag: string,
  filename: string,
): string {
  return `https://api.github.com/repos/${owner}/${repo}/releases/assets/${encodeURIComponent(filename)}?tag=${encodeURIComponent(releaseTag)}`;
}

const CACHE_ROOT = path.join(process.cwd(), '.cache', 'desktop-builds');
const installerInFlight = new Map<string, Promise<string>>();

function cacheKey(row: DesktopVersionRow): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return `${safe(row.platform)}-${safe(row.version)}-${safe(row.filename)}`;
}

export function cachedInstallerPath(row: DesktopVersionRow): string {
  return path.join(CACHE_ROOT, cacheKey(row));
}

export async function ensureDesktopCacheDir(): Promise<void> {
  await fsp.mkdir(CACHE_ROOT, { recursive: true });
}

/**
 * Ensure the installer is on disk (fetch from GitHub once, then reuse).
 * Concurrent misses for the same file share one GitHub download.
 */
export async function ensureCachedInstaller(row: DesktopVersionRow): Promise<string> {
  await ensureDesktopCacheDir();
  const dest = cachedInstallerPath(row);
  try {
    const st = await fsp.stat(dest);
    if (st.isFile() && st.size > 0) return dest;
  } catch {
    /* miss */
  }

  const pending = installerInFlight.get(dest);
  if (pending) return pending;

  const job = (async () => {
    try {
      // Re-check after winning the race.
      try {
        const st = await fsp.stat(dest);
        if (st.isFile() && st.size > 0) return dest;
      } catch {
        /* still miss */
      }

      const owner = githubWvOwner();
      const token = githubWvToken();
      if (!owner) throw new Error('GITHUB_WV_OWNER is not set');
      if (!token) {
        throw new Error(
          'GITHUB_WV_TOKEN is not set (required to download installers from a private releases repo)',
        );
      }

      const publicUrl = githubReleaseAssetUrl(owner, row.github_repo, row.release_tag, row.filename);
      const tmp = `${dest}.part`;

      const headers: Record<string, string> = {
        'User-Agent': 'Memories-Desktop-Cache',
        Accept: 'application/octet-stream',
        Authorization: `Bearer ${token}`,
      };

      let res = await fetch(publicUrl, { headers, redirect: 'follow' });

      if (!res.ok) {
        const releaseRes = await fetch(
          `https://api.github.com/repos/${owner}/${row.github_repo}/releases/tags/${encodeURIComponent(row.release_tag)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github+json',
              'User-Agent': 'Memories-Desktop-Cache',
            },
          },
        );
        if (releaseRes.ok) {
          const release = (await releaseRes.json()) as {
            assets?: Array<{ id: number; name: string; url: string }>;
          };
          const asset = release.assets?.find((a) => a.name === row.filename);
          if (asset) {
            res = await fetch(asset.url, {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/octet-stream',
                'User-Agent': 'Memories-Desktop-Cache',
              },
              redirect: 'follow',
            });
          }
        }
      }

      if (!res.ok || !res.body) {
        throw new Error(`Failed to fetch installer from GitHub (${res.status})`);
      }

      await fsp.mkdir(path.dirname(dest), { recursive: true });
      const buf = Buffer.from(await res.arrayBuffer());
      await fsp.writeFile(tmp, buf);
      await fsp.rename(tmp, dest);
      return dest;
    } finally {
      installerInFlight.delete(dest);
    }
  })();

  installerInFlight.set(dest, job);
  return job;
}

export function contentTypeForFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable';
  if (lower.endsWith('.dmg')) return 'application/x-apple-diskimage';
  if (lower.endsWith('.zip')) return 'application/zip';
  return 'application/octet-stream';
}

/** Clear other platform caches when a new version is published (optional). */
export async function clearCachedInstaller(row: Pick<DesktopVersionRow, 'platform' | 'version' | 'filename'>): Promise<void> {
  const dest = cachedInstallerPath(row as DesktopVersionRow);
  try {
    await fsp.unlink(dest);
  } catch {
    /* ignore */
  }
}

export function isFsCacheFresh(filePath: string): boolean {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}
