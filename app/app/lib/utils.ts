import { pipeline, type ImageClassificationSingle } from "@huggingface/transformers"
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
  // console.log('day: ', day, 'month: ', month, 'year: ', year)
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



export const CheckNSFW = async (imageUrl: string): Promise<boolean> => {
  let pip = await pipeline('image-classification', 'AdamCodd/vit-base-nsfw-detector');
  let result = await pip(imageUrl);
  let isNSFW = (result as ImageClassificationSingle[])[0].label === 'nsfw'
  return isNSFW
}