import React from "react"
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const arrangeDateForThumbnail = (created_at: string, retryAttempt: number = 0) => {
  const date = new Date(created_at)
  const dayNumber = retryAttempt >= 1 ? date.getUTCDate() - 1 : date.getUTCDate()
  const day = dayNumber.toString().padStart(2, '0')
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0')
  const year = date.getUTCFullYear()
  return `${day}_${month}_${year}`
}



const MEDIA_EXT_RE = /\.(m3u8|mp4|mov|webm|mkv|avi|m4v|ts|mp3|wav|m4a|flac|ogg|aac|jpe?g|png|webp|gif|avif|heic|heif|bmp|svg)$/i

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * STORAGE semantics — do not humanize. Legacy uploads store thumbnails as
 * `thumbnail_{ParseFilename(filename)}.jpg` in the date/uid folder, so this
 * must keep returning the real base name (only the HLS `.mp4.m3u8` tail is
 * stripped). For pretty titles use {@link displayMediaTitle} instead.
 */
export const ParseFilename = (filename: string, showLimit?: number) => {
  const parts = filename.split('.')
  if (parts.length >= 3 && parts[parts.length - 1] === 'm3u8') {
    parts.splice(-2, 2)
    return parts.join('.')
  }
  return filename
}

/**
 * DISPLAY-only title for cards/players. Strips media extensions (including
 * doubled ones like `.mp4.m3u8`), turns machine names (UUIDs, long hex ids)
 * into "Untitled", and swaps underscores for spaces in word-ish names.
 * Never use the result to build storage paths.
 */
export function displayMediaTitle(titleOrFilename: string, showLimit?: number): string {
  let name = (titleOrFilename || '').trim()
  for (let i = 0; i < 3 && MEDIA_EXT_RE.test(name); i++) {
    name = name.replace(MEDIA_EXT_RE, '')
  }
  if (!name) return 'Untitled'

  // `copy_<uuid>` and similar prefixes shouldn't rescue a machine name.
  const bare = name.replace(/^(copy|img|image|video|vid|file|download)[_\s-]*/i, '')
  const machineName =
    UUID_RE.test(bare) ||
    /^[0-9a-f_-]{16,}$/i.test(bare) ||
    /^[\d_\s.-]*$/.test(bare)
  if (machineName) return 'Untitled'

  // Only unglue separator-cased names; titles with real spaces stay as typed.
  if (!name.includes(' ')) name = name.replace(/_+/g, ' ').trim()
  return name || 'Untitled'
}


export const getDefaultThumbnail = (defaultThumbnail?: string | null): string | null => {
  if (!defaultThumbnail) return null
  // Strip surrounding JSON quotes that may leak from jsonb[] storage
  const cleaned = defaultThumbnail.replace(/^"|"$/g, '')
  return cleaned || null
}

/** @deprecated Use getDefaultThumbnail instead */
export const getRandomThumbnail = getDefaultThumbnail

/** Directory prefix (with trailing slash) where media siblings live (thumbs, waveform, HLS). */
function mediaPathDirPrefix(path: string): string | null {
  const trimmed = path.trim()
  if (!trimmed) return null
  const lastSlash = trimmed.lastIndexOf('/')
  if (lastSlash < 0) return null
  return trimmed.slice(0, lastSlash + 1)
}

/**
 * Build the thumbnail image URL for a file, across every storage version:
 * new uploads record default_thumbnail / thumb_*.jpg in the DB; legacy files
 * have neither and store `thumbnail_{ParseFilename(filename)}.jpg` in their
 * date/uid folder — that fallback must stay filename-based (storage key).
 */
export function getThumbnailUrl(file: {
  default_thumbnail?: string | null
  thumbnails?: string[] | null
  file_type?: string
  endpoint?: string
  created_at: string
  unique_id: string
  filename: string
}, opts?: { retryAttempt?: number; baseUrl?: string; queryString?: string }): string {
  const retry = opts?.retryAttempt ?? 0
  const base = opts?.baseUrl ?? ''
  const qs = opts?.queryString ?? ''

  // Images use endpoint directly
  if (file.file_type?.startsWith('image/') && file.endpoint) {
    return `${base}/api/load/image/${file.endpoint}${qs}`
  }

  const thumb = getDefaultThumbnail(file.default_thumbnail)
  if (thumb) {
    return `${base}/api/load/image/${thumb}${qs}`
  }

  // Prefer real frame thumbs (thumb_*.jpg); thumbnail_preview is a grid/sprite, not the default poster.
  if (Array.isArray(file.thumbnails) && file.thumbnails.length > 0) {
    const frame = file.thumbnails.find(
      (t) => /\/thumb_\d+\.jpg$/i.test(t) || /^thumb_\d+\.jpg$/i.test(t),
    )
    if (frame) return `${base}/api/load/image/${frame}${qs}`
    const preview = file.thumbnails.find(
      (t) => t.endsWith('/thumbnail_preview.jpg') || t === 'thumbnail_preview.jpg',
    )
    if (preview) return `${base}/api/load/image/${preview}${qs}`
    const storedDefault = file.thumbnails.find(
      (t) =>
        typeof t === 'string' &&
        (t.endsWith('/default_thumbnail.jpg') || t === 'default_thumbnail.jpg'),
    )
    if (storedDefault) return `${base}/api/load/image/${storedDefault}${qs}`
  }

  // Legacy fallback (old naming scheme): these files carry no thumbnail data
  // in the DB, the image lives at thumbnail_{filename}.jpg in their folder.
  return `${base}/api/load/image/${arrangeDateForThumbnail(file.created_at, retry)}/${file.unique_id}/thumbnail_${ParseFilename(file.filename)}.jpg${qs}`
}

/**
 * Resolve the storage folder for waveform.png (same logic order as getThumbnailUrl, plus HLS endpoint dirname).
 */
export function getWaveformImagePathPrefix(file: {
  default_thumbnail?: string | null
  thumbnails?: string[] | null
  endpoint?: string | null
  file_type?: string | null
}): string | null {
  const thumb = getDefaultThumbnail(file.default_thumbnail)
  if (thumb) {
    const prefix = mediaPathDirPrefix(thumb)
    if (prefix) return prefix
  }

  if (Array.isArray(file.thumbnails) && file.thumbnails.length > 0) {
    const frame = file.thumbnails.find(
      (t) => /\/thumb_\d+\.jpg$/i.test(t) || /^thumb_\d+\.jpg$/i.test(t),
    )
    const preview = file.thumbnails.find(
      (t) => t.endsWith('/thumbnail_preview.jpg') || t === 'thumbnail_preview.jpg',
    )
    const path = frame ?? preview ?? file.thumbnails[0]
    if (path && typeof path === 'string') {
      const prefix = mediaPathDirPrefix(path)
      if (prefix) return prefix
    }
  }

  const isHls =
    file.file_type === 'application/vnd.apple.mpegurl' ||
    (typeof file.endpoint === 'string' && file.endpoint.includes('.m3u8'))
  if (isHls && file.endpoint) {
    const prefix = mediaPathDirPrefix(file.endpoint.trim())
    if (prefix) return prefix
  }

  return null
}

/**
 * Relative paths (under `/api/load/image/`) to the seek-preview sprite JSON + JPEG, if the folder can be resolved.
 * Aligns with HLSPlayer: dirname of `default_thumbnail`, else {@link getWaveformImagePathPrefix}.
 */
export function getThumbnailPreviewApiPaths(file: {
  default_thumbnail?: string | null
  thumbnails?: string[] | null
  endpoint?: string | null
  file_type?: string | null
}): { json: string; jpg: string } | null {
  const thumb = getDefaultThumbnail(file.default_thumbnail)
  let dir = ''
  if (thumb && thumb.includes('/')) {
    dir = thumb.replace(/[^/]+$/, '')
  }
  if (!dir) {
    const wf = getWaveformImagePathPrefix(file)
    if (wf) dir = wf
  }
  if (!dir) return null
  const base = dir.endsWith('/') ? dir : `${dir}/`
  return {
    json: `${base}thumbnail_preview.json`,
    jpg: `${base}thumbnail_preview.jpg`,
  }
}

/**
 * Playback src for the HLS player  LoadPlay CDN only (`playbackUrl` from loader).
 */
export function getVideoSrc(_endpoint: string, _fileType?: string, playbackUrl?: string | null): string {
  return playbackUrl && playbackUrl.length > 0 ? playbackUrl : "";
}

/** Search / social preview crawlers  use canonical image URLs in HTML for indexing. */
export function isSearchBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua || typeof ua !== 'string') return false
  return /bytespider|applebot|googlebot|google-inspectiontool|bingbot|msnbot|slurp|duckduckbot|baiduspider|yandexbot|facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|embedly|pinterest|semrushbot|ahrefsbot|petalbot/i.test(
    ua,
  )
}