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

export const ParseFilename = (filename: string) => {
  const parts = filename.split('.')
  if (parts.length >= 3 && parts[parts.length - 1] === 'm3u8') {
    parts.splice(-2, 2)
    return parts.join('.')
  }
  return filename
}

export const getRandomThumbnail = (thumbnails?: string[]): string | null => {
  if (!thumbnails || thumbnails.length === 0) {
    return null
  }
  const randomIndex = Math.floor(Math.random() * thumbnails.length)
  return thumbnails[randomIndex]
}

export function getVideoSrc(endpoint: string, fileType?: string): string {
  if (!endpoint) return `/api/load/video/`
  const isHLS = fileType === 'application/vnd.apple.mpegurl' || endpoint.includes('.m3u8')
  if (isHLS && !endpoint.includes('.m3u8')) {
    return `/api/load/video/${endpoint.replace(/\/?$/, '')}/master.m3u8`
  }
  return `/api/load/video/${endpoint}`
}