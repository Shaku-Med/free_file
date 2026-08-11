import express from 'express';
type Request = express.Request;
type Response = express.Response;
import db from '../utils/database.js';
import { canAccessFile } from '../utils/auth.js';
import {
    defaultGithubBranch,
    githubRawFileUrl,
    resolveGithubRepoForFile,
} from '../utils/githubStorage.js';
import { getR2Client, r2PresignTtlSeconds } from '../utils/r2.js';
import { getMemoryCache } from '../utils/cache/memoryCache.js';
import { fileMetaCache, FILE_404_TTL_MS } from '../utils/cache/metadataCache.js';
import { buildFlightKey, getSingleFlight } from '../utils/cache/singleflight.js';

// GET /api/load/preview/<storage path> — the short silent MP4 GoUpload builds
// next to the thumbnails.

const router = express.Router();

const PREVIEW_CACHE = 'public, max-age=604800, immutable';
const PREVIEW_CDN_CACHE = 'public, s-maxage=604800, stale-while-revalidate=86400';
const PREVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Decoded before validation; otherwise %2e%2e walks straight past the checks.
function previewPathFromRequest(req: Request): string {
    let p = (req.path ?? '').replace(/^\/+/, '');
    const mountPrefix = 'api/load/preview/';
    if (p.startsWith(mountPrefix)) p = p.slice(mountPrefix.length);
    try {
        return decodeURIComponent(p);
    } catch {
        return '';
    }
}

// Exactly what GoUpload writes: <dateFolder>/<uniqueId>/hover_preview.mp4.
// Segments allow no dots or slashes, so traversal is impossible, and the
// filename is fixed, so this endpoint can never be pointed at the real video
// by swapping the last part of the path.
const PREVIEW_PATH_RE = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/hover_preview\.mp4$/;

function isPreviewPath(path: string): boolean {
    if (!path || path.length > 256) return false;
    return PREVIEW_PATH_RE.test(path);
}

type FileRow = {
    id: string;
    is_adult: boolean | null;
    is_public: boolean | null;
    visibility: string | null;
    owner_id: string | null;
    upload_status: string | null;
    github_repo: string | null;
    storage_backend: string | null;
    storage_bucket: string | null;
};

const getFileFromPath = async (path: string): Promise<FileRow | null> => {
    if (!db) return null;
    const parts = path.split('/');
    if (parts.length <= 2) return null;
    const uniqueId = parts[1]!;

    const hit = fileMetaCache.get(uniqueId);
    if (hit !== undefined) return hit as FileRow | null;

    const { data } = await db
        .from('files')
        .select(
            'id, is_adult, is_public, visibility, owner_id, upload_status, github_repo, storage_backend, storage_bucket',
        )
        .eq('unique_id', uniqueId)
        .maybeSingle();

    const value = (data as FileRow) || null;
    fileMetaCache.set(uniqueId, value, value === null ? FILE_404_TTL_MS : undefined);
    return value;
};

// Upload must be finished; mid-upload bytes still change.
function isServable(file: FileRow): boolean {
    const status = (file.upload_status ?? '').trim().toLowerCase();
    return !status || status === 'complete' || status === 'completed';
}

async function fetchUpstream(url: string): Promise<Buffer | null> {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return Buffer.from(await resp.arrayBuffer());
}

router.options('/*', (_req: Request, res: Response) => res.sendStatus(204));

router.get('/*', async (req: Request, res: Response) => {
    try {
        const path = previewPathFromRequest(req);
        if (!isPreviewPath(path)) return res.status(404).send(null);

        const file = await getFileFromPath(path);
        if (!file) return res.status(404).send(null);
        if (!isServable(file)) return res.status(404).send(null);

        // Adult/private need Authorization Bearer — standalone / cookie → 404
        // (same gate as image; 404 so we don't confirm the file exists).
        if (!(await canAccessFile(req, file as any))) {
            res.set('Cache-Control', 'no-store');
            return res.status(404).send(null);
        }

        const backend: 'gh' | 'r2' = file.storage_backend === 'r2' ? 'r2' : 'gh';
        const cache = getMemoryCache();
        const cacheKey = `preview\0${backend}\0${path}`;

        // Shared cache holds only what is safe to hand to the next anonymous
        // caller, so anything adult or not fully public is fetched per request.
        const isCacheable =
            file.is_adult !== true &&
            (file.visibility === 'public' ||
                (file.visibility == null && file.is_public === true));

        const cached = isCacheable ? cache.get(cacheKey) : undefined;
        if (cached) {
            res.set({
                'Content-Type': 'video/mp4',
                'Cache-Control': PREVIEW_CACHE,
                'CDN-Cache-Control': PREVIEW_CDN_CACHE,
                'Accept-Ranges': 'none',
                'X-Cache': 'HIT',
            });
            return res.send(cached.buffer);
        }

        // Coalesced after the access check above, keyed on the object only.
        const buffer = await getSingleFlight().run(
            buildFlightKey(backend, path),
            async () => {
                if (backend === 'r2') {
                    const r2 = getR2Client();
                    if (!r2) return null;
                    return fetchUpstream(r2.presignGet(path, r2PresignTtlSeconds()));
                }
                const owner = process.env.GITHUB_OWNER;
                if (!owner) return null;
                return fetchUpstream(
                    githubRawFileUrl(owner, resolveGithubRepoForFile(file), defaultGithubBranch(), path),
                );
            },
        );

        if (!buffer) return res.status(404).send(null);

        if (isCacheable) {
            cache.set(cacheKey, buffer, 'video/mp4', PREVIEW_CACHE, PREVIEW_TTL_MS);
        }

        res.set({
            'Content-Type': 'video/mp4',
            'Content-Length': String(buffer.length),
            'Cache-Control': isCacheable ? PREVIEW_CACHE : 'private, no-store',
            'CDN-Cache-Control': isCacheable ? PREVIEW_CDN_CACHE : 'no-store',
            'Accept-Ranges': 'none',
            'X-Cache': 'MISS',
        });
        return res.send(buffer);
    } catch (err) {
        console.error('[load/preview]', err);
        return res.status(500).send(null);
    }
});

export default router;
