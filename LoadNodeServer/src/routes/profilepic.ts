import express from 'express';
type Request = express.Request;
type Response = express.Response;
import db from '../utils/database.js';
import { getR2Client, r2PresignTtlSeconds } from '../utils/r2.js';

const router = express.Router();

// Mirrors the app's /api/load/profilepic so clients can fetch profile pics
// from this CDN node (same as /api/load/image). Backend per row:
//   storage_backend = 'r2' -> presigned R2 fetch
//   else                   -> raw.githubusercontent.com with users.github_repo
// Always also tries GitHub as a fallback (partial migrations).

const PROFILE_FILE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpe?g|png|gif|webp)$/i;
const USERNAME_FIRST_SEGMENT = /^[a-zA-Z0-9_-]{3,30}$/;
const VALID_REPO = /^[a-zA-Z0-9._-]{1,100}$/;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

function normalizePath(raw: string | undefined): string | null {
    if (!raw) return null;
    try {
        const decoded = decodeURIComponent(raw).replace(/\\/g, '/').trim();
        const collapsed = decoded.replace(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
        if (!collapsed || collapsed.includes('..')) return null;
        const segments = collapsed.split('/').filter(Boolean);
        if (segments.length !== 2) return null;
        if (segments.some((s) => s.startsWith('.') || s === '..')) return null;
        if (!USERNAME_FIRST_SEGMENT.test(segments[0])) return null;
        if (!PROFILE_FILE.test(segments[1])) return null;
        return segments.join('/');
    } catch {
        return null;
    }
}

function pathVariants(canon: string): string[] {
    return [...new Set([canon, `/${canon}`])];
}

interface UserRow {
    github_repo?: string | null;
    storage_backend?: string | null;
    profile_pic?: string | null;
}

function sameProfilePicPath(dbValue: string | null | undefined, canon: string): boolean {
    if (dbValue == null || typeof dbValue !== 'string') return false;
    const norm = (s: string) =>
        s.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').trim();
    return norm(dbValue) === canon;
}

async function resolveStorage(
    pathCanon: string,
): Promise<{ repo: string | null; backend: 'github' | 'r2' }> {
    if (!db) return { repo: null, backend: 'github' };
    try {
        const { data: rows } = await db
            .from('users')
            .select('github_repo, storage_backend')
            .in('profile_pic', pathVariants(pathCanon))
            .limit(1);
        const row = (rows ?? [])[0] as UserRow | undefined;
        if (row) {
            const backend: 'github' | 'r2' = row.storage_backend === 'r2' ? 'r2' : 'github';
            if (backend === 'r2') return { repo: null, backend: 'r2' };
            const r = typeof row.github_repo === 'string' ? row.github_repo.trim() : '';
            if (r && VALID_REPO.test(r)) return { repo: r, backend: 'github' };
        }
        const firstSeg = pathCanon.split('/')[0] ?? '';
        if (!USERNAME_FIRST_SEGMENT.test(firstSeg)) return { repo: null, backend: 'github' };
        const { data: byUser } = await db
            .from('users')
            .select('github_repo, profile_pic, storage_backend')
            .eq('username', firstSeg)
            .maybeSingle();
        if (!byUser) return { repo: null, backend: 'github' };
        const u = byUser as UserRow;
        if (!sameProfilePicPath(u.profile_pic, pathCanon)) return { repo: null, backend: 'github' };
        if (u.storage_backend === 'r2') return { repo: null, backend: 'r2' };
        const r2 = typeof u.github_repo === 'string' ? u.github_repo.trim() : '';
        if (r2 && VALID_REPO.test(r2)) return { repo: r2, backend: 'github' };
        return { repo: null, backend: 'github' };
    } catch {
        return { repo: null, backend: 'github' };
    }
}

function sniffContentType(buf: Buffer): string | null {
    if (buf.length < 12) return null;
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
    if (
        buf[0] === 0x52 &&
        buf[1] === 0x49 &&
        buf[2] === 0x46 &&
        buf[3] === 0x46 &&
        buf[8] === 0x57 &&
        buf[9] === 0x45 &&
        buf[10] === 0x42 &&
        buf[11] === 0x50
    ) {
        return 'image/webp';
    }
    return null;
}

router.options('/*', (_req: Request, res: Response) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS, HEAD');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Cookie, c-user, Authorization');
    res.sendStatus(204);
});

router.get('/*', async (req: Request, res: Response) => {
    try {
        const rawPath = (req.originalUrl ?? req.url ?? '')
            .split('?')[0]
            .replace(/^.*\/api\/load\/profilepic\//, '');
        const path = normalizePath(rawPath);
        if (!path) return res.status(400).send(null);

        const owner = process.env.GITHUB_OWNER;
        const storage = await resolveStorage(path);

        const urls: string[] = [];
        if (storage.backend === 'r2') {
            const r2 = getR2Client();
            if (r2) {
                urls.push(r2.presignGet(path, r2PresignTtlSeconds()));
            } else {
                // Surface loudly  if this fires in prod, the R2_* env vars
                // never reached LoadNodeServer (check /api/server-env's
                // REQUIRED_ENV_KEYS) and every R2 pic silently falls to GitHub.
                console.warn('[profilepic] backend=r2 but R2 not configured; falling back to GitHub for', path);
            }
        }
        // Always also try GitHub as fallback (partial migration safety).
        if (owner) {
            const tried = new Set<string>();
            const push = (repo: string | null | undefined) => {
                const t = (repo ?? '').trim();
                if (!t || tried.has(t) || !VALID_REPO.test(t)) return;
                tried.add(t);
                urls.push(`https://raw.githubusercontent.com/${owner}/${t}/main/${path}`);
            };
            push(storage.repo);
            push(process.env.GITHUB_REPO);
            push(process.env.GITHUB_DEFAULT_REPO);
            push('Memories');
        }
        if (urls.length === 0) return res.status(503).send(null);

        for (const url of urls) {
            try {
                const r = await fetch(url);
                if (!r.ok) continue;
                const cl = r.headers.get('content-length');
                const clParsed = cl ? parseInt(cl, 10) : NaN;
                if (Number.isFinite(clParsed) && clParsed > MAX_IMAGE_BYTES) continue;
                const arr = await r.arrayBuffer();
                if (arr.byteLength > MAX_IMAGE_BYTES) continue;
                const buf = Buffer.from(arr);
                const ct =
                    (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() ||
                    sniffContentType(buf);
                if (!ct || !ct.startsWith('image/')) continue;

                res.set({
                    'Content-Type': ct,
                    // Cache for 3h. Cache-busted by ?v=N when the user changes their pic.
                    'Cache-Control': 'public, max-age=10800',
                    'CDN-Cache-Control': 'public, max-age=10800',
                    'X-Content-Type-Options': 'nosniff',
                    'Access-Control-Allow-Origin': '*',
                });
                return res.send(buf);
            } catch {
                /* try next */
            }
        }

        return res.status(404).send(null);
    } catch {
        return res.status(500).send(null);
    }
});

export default router;
