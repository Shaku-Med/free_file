import { imageDB, type ImageCacheEntry } from './database'

export const storeImageBlob = async (
  imageID: string, 
  blob: Blob, 
  link: string
): Promise<string> => {
  try {
    return await imageDB.storeImage(imageID, blob, link)
  } catch (error) {
    console.error('Failed to store image in IndexedDB:', error)
    return URL.createObjectURL(blob)
  }
}

export const getImageBlob = async (imageID: string): Promise<ImageCacheEntry | null> => {
  try {
    return await imageDB.getImage(imageID)
  } catch (error) {
    console.error('Failed to get image from IndexedDB:', error)
    return null
  }
}

export const hasImageBlob = async (imageID: string): Promise<boolean> => {
  try {
    return await imageDB.hasImage(imageID)
  } catch (error) {
    console.error('Failed to check image in IndexedDB:', error)
    return false
  }
}

export const getImageByLink = async (link: string): Promise<ImageCacheEntry | null> => {
  try {
    return await imageDB.getImageByLink(link)
  } catch (error) {
    console.error('Failed to get image by link from IndexedDB:', error)
    return null
  }
}

export const clearOldImages = async (maxAgeDays: number = 7): Promise<void> => {
  try {
    const maxAge = maxAgeDays * 24 * 60 * 60 * 1000
    await imageDB.clearOldImages(maxAge)
  } catch (error) {
    console.error('Failed to clear old images from IndexedDB:', error)
  }
}

export const deleteImageBlob = async (imageID: string): Promise<void> => {
  try {
    await imageDB.deleteImage(imageID)
  } catch (error) {
    console.error('Failed to delete image from IndexedDB:', error)
  }
}
