import type { MetaDescriptor } from 'react-router';
import { IMAGE_BASE_URL } from '~/lib/URLS';
import { previewPathFor } from '~/lib/files/hoverPreview';

/**
 * Search engines and social cards need a real, crawlable video file. The HLS
 * manifest is neither: it needs a signed token and a crawler cannot play it.
 * The hover preview is a plain public MP4, which is exactly what they want.
 */

type SeoFile = {
  is_public?: boolean | null;
  visibility?: string | null;
  is_adult?: boolean | null;
  preview_endpoint?: string | null;
  duration?: number | string | null;
  file_type?: string | null;
  default_thumbnail?: string | null;
  is_reel?: boolean | null;
};

/**
 * Only fully public, non-adult videos are advertised.
 *
 * Unlisted is deliberately excluded: handing Google a contentUrl would get it
 * indexed, which is the one thing unlisted is supposed to prevent. Adult is
 * excluded because the loader refuses it to anonymous callers anyway, so the
 * URL would 404 for a crawler.
 */
export function seoPreviewUrl(file: SeoFile | null | undefined): string | null {
  if (!file) return null;
  if (file.is_adult === true) return null;

  const visibility = typeof file.visibility === 'string' ? file.visibility : null;
  const isPublic = visibility ? visibility === 'public' : file.is_public === true;
  if (!isPublic) return null;

  const path = previewPathFor(file as never);
  return path ? `${IMAGE_BASE_URL}/api/load/preview/${path}` : null;
}

/** Seconds to ISO 8601 (PT1M30S), which is the only form Google accepts. */
export function iso8601Duration(seconds: number | string | null | undefined): string | null {
  const n = typeof seconds === 'string' ? Number(seconds) : seconds;
  if (!n || !Number.isFinite(n) || n <= 0) return null;
  const total = Math.round(n);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s || (!h && !m) ? `${s}S` : ''}`;
}

/**
 * VideoObject for a watch or reel page.
 *
 * Returns null when the video is not eligible, so callers can fall back to
 * whatever they emitted before rather than publishing a half-filled object.
 */
export function buildVideoObject(input: {
  file: SeoFile | null | undefined;
  name: string;
  description: string;
  pageUrl: string;
  thumbnailUrl: string;
  uploadDate?: string | null;
  authorName?: string | null;
}): Record<string, unknown> | null {
  const contentUrl = seoPreviewUrl(input.file);
  if (!contentUrl) return null;

  const duration = iso8601Duration(input.file?.duration);

  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: input.name,
    description: input.description,
    thumbnailUrl: input.thumbnailUrl,
    contentUrl,
    embedUrl: input.pageUrl,
    url: input.pageUrl,
    ...(input.uploadDate ? { uploadDate: input.uploadDate } : {}),
    ...(duration ? { duration } : {}),
    ...(input.authorName
      ? { author: { '@type': 'Person', name: input.authorName } }
      : {}),
  };
}

/** og:video and twitter player tags pointing at the same public MP4. */
export function videoPreviewMeta(
  file: SeoFile | null | undefined,
  thumbnailUrl: string,
): MetaDescriptor[] {
  const url = seoPreviewUrl(file);
  if (!url) return [];
  return [
    { property: 'og:video', content: url },
    { property: 'og:video:url', content: url },
    { property: 'og:video:secure_url', content: url },
    { property: 'og:video:type', content: 'video/mp4' },
    { name: 'twitter:card', content: 'player' },
    { name: 'twitter:player:stream', content: url },
    { name: 'twitter:player:stream:content_type', content: 'video/mp4' },
    { name: 'twitter:image', content: thumbnailUrl },
  ];
}
