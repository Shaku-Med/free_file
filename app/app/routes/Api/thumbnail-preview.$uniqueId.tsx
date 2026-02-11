import { data } from 'react-router';
import db from '~/lib/Database/supabase';
import { canAccessFile } from '~/routes/Api/fun/accessControl';

const CELL_SIZE = 160;

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
    .select('unique_id, thumbnails, duration, is_public, is_adult, upload_status')
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
    cellSize: CELL_SIZE,
    interval,
    cells,
  };

  if (wantSprite) {
    let sharp: any = null;
    try {
      // @ts-expect-error sharp is optional; types may be missing
      sharp = (await import('sharp')).default;
    } catch {
      sharp = null;
    }
    if (!sharp) {
      return data({ error: 'Image processing unavailable' }, { status: 503 });
    }

    const baseUrl = `https://github.com/${process.env.GITHUB_OWNER}/Memories/raw/main/`;
    const width = cols * CELL_SIZE;
    const height = rows * CELL_SIZE;
    const compositeInput: { input: Buffer; top: number; left: number }[] = [];
    let filled = 0;

    for (let i = 0; i < count; i++) {
      const path = thumbnails[i];
      if (!path || typeof path !== 'string') continue;
      try {
        const res = await fetch(baseUrl + path);
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        const resized = await sharp(buf)
          .resize(CELL_SIZE, CELL_SIZE, { fit: 'cover' })
          .toBuffer();
        const row = Math.floor(i / cols);
        const col = i % cols;
        compositeInput.push({
          input: resized,
          top: row * CELL_SIZE,
          left: col * CELL_SIZE,
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
