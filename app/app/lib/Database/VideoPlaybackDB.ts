const DB_NAME = 'VideoPlaybackDB'
const DB_VERSION = 1
const STORE_NAME = 'videoPlaybackPositions'

export interface VideoPlaybackPosition {
  id: string // video unique ID (imageID)
  currentTime: number
  duration: number
  timestamp: number
  src?: string // optional: video source URL
}

class VideoPlaybackDatabase {
  private db: IDBDatabase | null = null

  /**
   * Check if we're in browser environment
   */
  private isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
  }

  async init(): Promise<void> {
    if (!this.isBrowser()) {
      return Promise.resolve();
    }

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
        }
      }
    })
  }

  /**
   * Save video playback position
   */
  async savePosition(
    id: string,
    currentTime: number,
    duration: number,
    src?: string
  ): Promise<void> {
    if (!this.isBrowser()) return;
    if (!this.db) await this.init()

    const entry: VideoPlaybackPosition = {
      id,
      currentTime,
      duration,
      timestamp: Date.now(),
      src
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.put(entry)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Get saved playback position for a video
   */
  async getPosition(id: string): Promise<VideoPlaybackPosition | null> {
    if (!this.isBrowser()) return null;
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(id)

      request.onsuccess = () => {
        const result = request.result
        resolve(result || null)
      }
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Delete saved position for a video
   */
  async deletePosition(id: string): Promise<void> {
    if (!this.isBrowser()) return;
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.delete(id)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Clear old playback positions (older than maxAge)
   * @param maxAge Maximum age in milliseconds (default: 30 days)
   */
  async clearOldPositions(maxAge: number = 30 * 24 * 60 * 60 * 1000): Promise<void> {
    if (!this.isBrowser()) return;
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

  /**
   * Clear all playback positions
   */
  async clearAll(): Promise<void> {
    if (!this.isBrowser()) return;
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.clear()

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}

export const videoPlaybackDB = new VideoPlaybackDatabase()
