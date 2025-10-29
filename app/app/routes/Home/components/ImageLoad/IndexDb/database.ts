const DB_NAME = 'ImageCacheDB'
const DB_VERSION = 1
const STORE_NAME = 'imageBlobs'

export interface ImageCacheEntry {
  id: string
  blob: Blob
  url: string
  timestamp: number
  link: string
}

class ImageDatabase {
  private db: IDBDatabase | null = null

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
          store.createIndex('timestamp', 'timestamp', { unique: false })
          store.createIndex('link', 'link', { unique: false })
        }
      }
    })
  }

  async storeImage(id: string, blob: Blob, link: string): Promise<string> {
    if (!this.db) await this.init()

    const url = URL.createObjectURL(blob)
    const entry: ImageCacheEntry = {
      id,
      blob,
      url,
      timestamp: Date.now(),
      link
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.put(entry)

      request.onsuccess = () => resolve(url)
      request.onerror = () => reject(request.error)
    })
  }

  async getImage(id: string): Promise<ImageCacheEntry | null> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(id)

      request.onsuccess = () => {
        const result = request.result
        if (result) {
          URL.revokeObjectURL(result.url)
          result.url = URL.createObjectURL(result.blob)
        }
        resolve(result || null)
      }
      request.onerror = () => reject(request.error)
    })
  }

  async hasImage(id: string): Promise<boolean> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.count(IDBKeyRange.only(id))

      request.onsuccess = () => resolve(request.result > 0)
      request.onerror = () => reject(request.error)
    })
  }

  async deleteImage(id: string): Promise<void> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.delete(id)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async clearOldImages(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    if (!this.db) await this.init()

    const cutoffTime = Date.now() - maxAge

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const index = store.index('timestamp')
      const request = index.openCursor(IDBKeyRange.upperBound(cutoffTime))

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          cursor.delete()
          cursor.continue()
        } else {
          resolve()
        }
      }
      request.onerror = () => reject(request.error)
    })
  }

  async getImageByLink(link: string): Promise<ImageCacheEntry | null> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const index = store.index('link')
      const request = index.get(link)

      request.onsuccess = () => {
        const result = request.result
        if (result) {
          URL.revokeObjectURL(result.url)
          result.url = URL.createObjectURL(result.blob)
        }
        resolve(result || null)
      }
      request.onerror = () => reject(request.error)
    })
  }
}

export const imageDB = new ImageDatabase()
