import db from '~/lib/Database/supabase';
import { verifyWebhookSecret } from '~/lib/Security/webhookAuth.server';

/**
 * Server-to-server webhook from the AcoustID sidecar (private VPS → app).
 * Upserts the shared song catalog and links files.acoustid_recording_id.
 *
 * Queue / in-flight / result staging is Redis on the GoUpload box — there is
 * no SQL pending table. The files row already exists from the "queued"
 * upload webhook by the time AcoustID runs.
 */

type MatchBody = {
  score?: number;
  acoustid?: string | null;
  recording_mbid?: string | null;
  release_group_mbid?: string | null;
  title?: string;
  artists?: string;
  album?: string | null;
  duration?: number | null;
  cover_art?: string | null;
  musicbrainz_url?: string | null;
};

const SAFE_UPLOAD_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asTrimmed(v: unknown, max = 500): string {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

function isUsableMatch(match: MatchBody): boolean {
  const recordingMbid = asTrimmed(match.recording_mbid, 64);
  const title = asTrimmed(match.title, 500);
  const artists = asTrimmed(match.artists, 500);
  if (!recordingMbid || !SAFE_MBID.test(recordingMbid)) return false;
  if (!title || /^unknown title$/i.test(title)) return false;
  if (/matched,\s*but musicbrainz/i.test(title)) return false;
  if (!artists || /^unknown artist$/i.test(artists)) return false;
  return true;
}

async function upsertRecording(match: MatchBody): Promise<string | null> {
  if (!db) return null;

  // No MusicBrainz metadata ⇒ do not insert catalog stubs.
  if (!isUsableMatch(match)) {
    console.log('[acoustid-result] skip stub match (no usable MusicBrainz metadata)');
    return null;
  }

  const recordingMbid = asTrimmed(match.recording_mbid, 64);
  const acoustid = asTrimmed(match.acoustid, 64);
  const title = asTrimmed(match.title, 500);
  const artists = asTrimmed(match.artists, 500);
  const album = asTrimmed(match.album, 500) || null;
  const releaseGroupMbid = asTrimmed(match.release_group_mbid, 64) || null;
  // Hosted storage path only (GoUpload uploads acoustid_cover.jpg). Reject URLs.
  const coverRaw = asTrimmed(match.cover_art, 500);
  const coverArt =
    coverRaw &&
    !/^https?:\/\//i.test(coverRaw) &&
    /^\d{2}_\d{2}_\d{4}\//.test(coverRaw)
      ? coverRaw
      : null;
  const musicbrainzUrl = asTrimmed(match.musicbrainz_url, 500) || null;
  const duration =
    typeof match.duration === 'number' && Number.isFinite(match.duration) && match.duration >= 0
      ? match.duration
      : null;

  const row = {
    acoustid: acoustid || null,
    recording_mbid: recordingMbid || null,
    release_group_mbid: releaseGroupMbid && SAFE_MBID.test(releaseGroupMbid) ? releaseGroupMbid : null,
    title,
    artists,
    album,
    duration,
    cover_art_url: coverArt,
    musicbrainz_url: musicbrainzUrl,
    updated_at: new Date().toISOString(),
  };

  if (recordingMbid) {
    const { data: existing } = await db
      .from('acoustid_recordings')
      .select('id')
      .eq('recording_mbid', recordingMbid)
      .maybeSingle();
    const existingId = (existing as { id?: string } | null)?.id;
    if (existingId) {
      const { error } = await db.from('acoustid_recordings').update(row).eq('id', existingId);
      if (error) {
        console.warn('[acoustid-result] update recording:', error.message ?? error);
        return existingId;
      }
      return existingId;
    }
  }

  // Always key catalog rows on recording_mbid (required by isUsableMatch).
  const { data: inserted, error: insertErr } = await db
    .from('acoustid_recordings')
    .insert(row)
    .select('id')
    .single();
  if (insertErr) {
    console.error('[acoustid-result] insert recording:', insertErr.message ?? insertErr);
    return null;
  }
  return (inserted as { id?: string } | null)?.id ?? null;
}

export async function action({ request }: { request: Request }) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!verifyWebhookSecret(request)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!db) {
    return new Response(JSON.stringify({ error: 'unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: {
    job_id?: string;
    upload_id?: string;
    unique_id?: string;
    matched?: boolean;
    match?: MatchBody | null;
    error?: string;
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const uploadId = asTrimmed(body?.upload_id || body?.unique_id, 128);
  if (!uploadId || !SAFE_UPLOAD_ID.test(uploadId)) {
    return new Response(JSON.stringify({ error: 'invalid upload_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (body?.matched !== true || !body.match || typeof body.match !== 'object') {
    console.log('[acoustid-result] no match upload=', uploadId, body?.error || '');
    // Clear a previous wrong/stub link when a re-identify finds nothing usable.
    const { error: clearErr } = await db
      .from('files')
      .update({ acoustid_recording_id: null })
      .eq('unique_id', uploadId)
      .not('acoustid_recording_id', 'is', null);
    if (clearErr) {
      console.warn('[acoustid-result] clear link failed:', clearErr.message ?? clearErr);
    }
    return new Response(JSON.stringify({ ok: true, matched: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!isUsableMatch(body.match)) {
    console.log('[acoustid-result] ignore stub match upload=', uploadId);
    const { error: clearErr } = await db
      .from('files')
      .update({ acoustid_recording_id: null })
      .eq('unique_id', uploadId)
      .not('acoustid_recording_id', 'is', null);
    if (clearErr) {
      console.warn('[acoustid-result] clear stub link failed:', clearErr.message ?? clearErr);
    }
    return new Response(JSON.stringify({ ok: true, matched: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const recordingId = await upsertRecording(body.match);
  if (!recordingId) {
    return new Response(JSON.stringify({ error: 'upsert_failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const coverPath = asTrimmed(body.match.cover_art, 500);
  // Only accept hosted storage paths (same shape as thumbnails), never http(s) URLs.
  const hostedCover =
    coverPath &&
    !/^https?:\/\//i.test(coverPath) &&
    /^\d{2}_\d{2}_\d{4}\/[A-Za-z0-9_-]{1,128}\/acoustid_cover\.(jpg|jpeg|png|webp)$/i.test(
      coverPath,
    )
      ? coverPath
      : null;

  // Identified song ⇒ treat as music even if MusicDetector missed it
  // (e.g. official music videos with lots of speech/FX).
  const filePatch: Record<string, unknown> = {
    acoustid_recording_id: recordingId,
    is_music: true,
  };

  const { data: fileRow } = await db
    .from('files')
    .select('id, thumbnails, default_thumbnail')
    .eq('unique_id', uploadId)
    .maybeSingle();

  if (fileRow && hostedCover) {
    const existingThumbs = Array.isArray((fileRow as { thumbnails?: unknown }).thumbnails)
      ? ((fileRow as { thumbnails: unknown[] }).thumbnails.filter(
          (t): t is string => typeof t === 'string' && t.trim() !== '',
        ) as string[])
      : [];
    if (!existingThumbs.includes(hostedCover)) {
      filePatch.thumbnails = [...existingThumbs, hostedCover];
    }
    const curDefault = asTrimmed((fileRow as { default_thumbnail?: unknown }).default_thumbnail, 500);
    if (!curDefault) {
      filePatch.default_thumbnail = hostedCover;
    }
  }

  const { data: updatedRows, error: linkErr } = await db
    .from('files')
    .update(filePatch)
    .eq('unique_id', uploadId)
    .select('id');
  if (linkErr) {
    console.warn('[acoustid-result] link file:', linkErr.message ?? linkErr);
  } else if (!updatedRows?.length) {
    console.log('[acoustid-result] catalog ok, file row not ready upload=', uploadId);
  } else {
    console.log(
      '[acoustid-result] linked upload=',
      uploadId,
      'recording=',
      recordingId,
      'cover=',
      hostedCover || '-',
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      matched: true,
      recording_id: recordingId,
      cover_art: hostedCover,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
