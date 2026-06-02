import { data } from 'react-router';
import db from '~/lib/Database/supabase';
import {
  defaultGithubBranch,
  githubRawFileUrl,
  resolveGithubRepoForFile,
} from '~/lib/githubStorage';
import { r2PresignGet } from '~/lib/r2.server';
import { canAccessFile } from '~/routes/Api/fun/accessControl';

const CELL_WIDTH = 160;
const CELL_HEIGHT = 90;

export const loader = async ({
  request,
  params,
}: {
  request: Request;
  params: { uniqueId: string };
}) => {
  const uniqueId = params.uniqueId;
  if (!uniqueId) {
    return data({ error: 'Missing uniqueId' }, { status: 400 });
  }

  const url = new URL(request.url);
  const wantSprite = url.searchParams.get('sprite') === '1';

  if (!db) {
    return data({ error: 'Database not available' }, { status: 503 });
  }

  const { data: file, error } = await db
    .from('files')
    .select('unique_id, thumbnails, duration, is_public, is_adult, upload_status, github_repo, storage_backend, storage_bucket')
    .eq('unique_id', uniqueId)
    .maybeSingle();

  if (error || !file) {
    return data({ error: 'File not found' }, { status: 404 });
  }

  const thumbnails = Array.isArray(file.thumbnails) ? file.thumbnails : [];
  const safeDuration =
    typeof file.duration === 'number' && file.duration > 0
      ? file.duration
      : thumbnails.length > 0
        ? thumbnails.length * 5
        : 0;

  if (thumbnails.length === 0 || safeDuration <= 0) {
    return data({ error: 'No thumbnails or duration' }, { status: 404 });
  }

  const hasAccess = await canAccessFile(request, file as any);
  if (!hasAccess && !(file as any).is_public) {
    return data({ error: 'Access denied' }, { status: 403 });
  }

  const count = thumbnails.length;
  const cols = Math.min(5, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / cols);
  const interval = safeDuration / count;
  const cells = Array.from({ length: count }, (_, i) => ({
    index: i,
    start: i * interval,
    end: (i + 1) * interval,
  }));

  const meta = {
    duration: safeDuration,
    cols,
    rows,
    cellSize: CELL_WIDTH,
    cellWidth: CELL_WIDTH,
    cellHeight: CELL_HEIGHT,
    interval,
    cells,
  };

  if (wantSprite) {
    let sharp: any = null;
    try {
      sharp = (await import('sharp')).default;
    } catch {
      sharp = null;
    }
    if (!sharp) {
      return data({ error: 'Image processing unavailable' }, { status: 503 });
    }

    // Per-file storage backend: presign R2 objects, else GitHub raw.
    const isR2 = (file as { storage_backend?: string | null }).storage_backend === 'r2';
    let resolveObjectUrl: (objectPath: string) => string | null;
    if (isR2) {
      resolveObjectUrl = (objectPath: string) => r2PresignGet(objectPath);
    } else {
      const owner = process.env.GITHUB_OWNER;
      if (!owner) {
        return data({ error: 'Storage not configured' }, { status: 503 });
      }
      const repo = resolveGithubRepoForFile(file as { github_repo?: string | null });
      const branch = defaultGithubBranch();
      const baseUrl = githubRawFileUrl(owner, repo, branch, '');
      resolveObjectUrl = (objectPath: string) => baseUrl + objectPath;
    }
    const width = cols * CELL_WIDTH;
    const height = rows * CELL_HEIGHT;
    const compositeInput: { input: Buffer; top: number; left: number }[] = [];
    let filled = 0;

    for (let i = 0; i < count; i++) {
      const path = thumbnails[i];
      if (!path || typeof path !== 'string') continue;
      try {
        const objectUrl = resolveObjectUrl(path);
        if (!objectUrl) continue;
        const res = await fetch(objectUrl);
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        const resized = await sharp(buf)
          .resize(CELL_WIDTH, CELL_HEIGHT, { fit: 'contain', background: { r: 0, g: 0, b: 0 } })
          .toBuffer();
        const row = Math.floor(i / cols);
        const col = i % cols;
        compositeInput.push({
          input: resized,
          top: row * CELL_HEIGHT,
          left: col * CELL_WIDTH,
        });
        filled++;
      } catch {
        // skip failed thumb
      }
    }

    if (filled === 0) {
      return data({ error: 'Could not load thumbnails' }, { status: 502 });
    }

    const background = sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 24, g: 24, b: 27 },
      },
    });

    const composed = await compositeInput.reduce(
      (acc, { input, top, left }) =>
        acc.composite([{ input, top, left }]),
      background
    );

    const jpeg = await composed.jpeg({ quality: 85 }).toBuffer();

    return new Response(jpeg, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  const spriteUrl = `/api/thumbnail-preview/${uniqueId}?sprite=1`;

  return new Response(JSON.stringify({ meta, spriteUrl }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    },
  });
};
