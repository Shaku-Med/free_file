interface DownloadJob {
  jobId: string;
  fileId: string;
  fileType: 'image' | 'video';
  fileUrl: string;
  filename: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  downloadUrl?: string;
  userId?: string;
  cancelled?: boolean;
  headers?: Record<string, string>;
}

type ProgressCallback = (jobId: string, progress: number) => void;

class DownloadQueue {
  private jobs: Map<string, DownloadJob> = new Map();
  private processing: Set<string> = new Set();
  private maxConcurrent: number = 3; // Process 3 downloads concurrently
  private maxQueueSize: number = 1000;
  private progressCallbacks: Map<string, ProgressCallback> = new Map();

  /**
   * Add a download job to the queue
   */
  addJob(job: Omit<DownloadJob, 'status' | 'progress' | 'createdAt'>): string {
    if (this.jobs.size >= this.maxQueueSize) {
      throw new Error('Queue is full');
    }

    const newJob: DownloadJob = {
      ...job,
      status: 'pending',
      progress: 0,
      createdAt: Date.now(),
      cancelled: false
    };

    this.jobs.set(newJob.jobId, newJob);
    this.processQueue().catch((error) => {
      console.error('Error processing download queue:', error);
    });

    return newJob.jobId;
  }

  /**
   * Get job status
   */
  getJobStatus(jobId: string): DownloadJob | null {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Cancel a job
   */
  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (job.status === 'completed' || job.status === 'failed') {
      return false;
    }

    job.cancelled = true;
    job.status = 'cancelled';
    this.processing.delete(jobId);
    return true;
  }

  /**
   * Register progress callback
   */
  onProgress(jobId: string, callback: ProgressCallback): void {
    this.progressCallbacks.set(jobId, callback);
  }

  /**
   * Remove progress callback
   */
  offProgress(jobId: string): void {
    this.progressCallbacks.delete(jobId);
  }

  /**
   * Update job progress
   */
  private updateProgress(jobId: string, progress: number): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.progress = Math.min(100, Math.max(0, progress));
      const callback = this.progressCallbacks.get(jobId);
      if (callback) {
        callback(jobId, job.progress);
      }
    }
  }

  /**
   * Process the queue
   */
  private async processQueue(): Promise<void> {
    if (this.processing.size >= this.maxConcurrent) {
      return;
    }

    // Find next pending job
    let pendingJob: DownloadJob | null = null;
    for (const job of this.jobs.values()) {
      if (job.status === 'pending' && !this.processing.has(job.jobId)) {
        pendingJob = job;
        break;
      }
    }

    if (!pendingJob) {
      return;
    }

    this.processing.add(pendingJob.jobId);
    pendingJob.status = 'processing';
    pendingJob.startedAt = Date.now();

    // Process job in background (non-blocking)
    this.processJob(pendingJob).catch((error) => {
      console.error(`Error processing download job ${pendingJob.jobId}:`, error);
      if (pendingJob) {
        pendingJob.status = 'failed';
        pendingJob.error = 'Download failed';
      }
    }).finally(() => {
      if (pendingJob) {
        this.processing.delete(pendingJob.jobId);
      }
      // Process next job
      setTimeout(() => {
        this.processQueue().catch((error) => {
          console.error('Error processing next queue item:', error);
        });
      }, 100);
    });
  }

  /**
   * Process a single download job
   */
  private async processJob(job: DownloadJob): Promise<void> {
    const { join } = await import('path');
    const { mkdir, unlink } = await import('fs/promises');
    const { existsSync } = await import('fs');
    const tempDir = join(process.cwd(), 'temp', 'downloads');
    let tempFilesToCleanup: string[] = [];

    try {
      if (job.cancelled) {
        job.status = 'cancelled';
        return;
      }

      if (!existsSync(tempDir)) {
        await mkdir(tempDir, { recursive: true });
      }

      this.updateProgress(job.jobId, 10);

      if (job.fileType === 'image') {
        const outputPath = join(tempDir, `${job.jobId}_${job.filename}`);
        tempFilesToCleanup.push(outputPath);
        await this.downloadImage(job, tempDir);
      } else if (job.fileType === 'video') {
        const outputPath = join(tempDir, `${job.jobId}_${job.filename.replace(/\.m3u8$/, '.mp4')}`);
        tempFilesToCleanup.push(outputPath);
        await this.downloadHLSVideo(job, tempDir, tempFilesToCleanup);
      }

      if (job.cancelled) {
        job.status = 'cancelled';
        return;
      }

      job.status = 'completed';
      job.progress = 100;
      job.completedAt = Date.now();
      job.downloadUrl = `/api/download/file/${job.jobId}`;

    } catch (error) {
      job.status = 'failed';
      job.error = 'Download failed';
      console.error(`Download job ${job.jobId} failed:`, error);
    } finally {
      if (job.status === 'cancelled' || job.status === 'failed') {
        await this.cleanupTempFiles(tempFilesToCleanup);
      }
    }
  }

  /**
   * Download image
   */
  private async downloadImage(job: DownloadJob, tempDir: string): Promise<void> {
    const { join } = await import('path');
    const { writeFile } = await import('fs/promises');

    this.updateProgress(job.jobId, 20);

    const response = await fetch(job.fileUrl, {
      headers: job.headers || {}
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    if (job.cancelled) return;

    const arrayBuffer = await response.arrayBuffer();
    this.updateProgress(job.jobId, 80);

    if (job.cancelled) return;

    const outputPath = join(tempDir, `${job.jobId}_${job.filename}`);
    await writeFile(outputPath, Buffer.from(arrayBuffer));
    
    this.updateProgress(job.jobId, 100);
  }

  /**
   * Download HLS video (all segments)
   */
  private async downloadHLSVideo(job: DownloadJob, tempDir: string, tempFilesToCleanup: string[]): Promise<void> {
    const { join } = await import('path');
    const { writeFile, unlink } = await import('fs/promises');
    const { existsSync } = await import('fs');
    const { createWriteStream } = await import('fs');
    const { createReadStream } = await import('fs');
    const { pipeline } = await import('stream/promises');
    const segmentFiles: string[] = [];

    try {
      this.updateProgress(job.jobId, 15);

      const manifestResponse = await fetch(job.fileUrl, {
        headers: job.headers || {}
      });
      if (!manifestResponse.ok) {
        throw new Error(`Failed to fetch HLS manifest: ${manifestResponse.statusText}`);
      }

      const manifestText = await manifestResponse.text();
      if (job.cancelled) return;

      const manifestBaseUrl = new URL(job.fileUrl);
      const manifestDir = manifestBaseUrl.pathname.substring(0, manifestBaseUrl.pathname.lastIndexOf('/') + 1);
      const segmentUrls: string[] = [];
      const lines = manifestText.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !line.startsWith('#')) {
          if (line.startsWith('http://') || line.startsWith('https://')) {
            segmentUrls.push(line);
          } else {
            const segmentUrl = new URL(line, `${manifestBaseUrl.origin}${manifestDir}`).href;
            segmentUrls.push(segmentUrl);
          }
        }
      }

      if (segmentUrls.length === 0) {
        throw new Error('No segments found in HLS manifest');
      }

      this.updateProgress(job.jobId, 25);

      const totalSegments = segmentUrls.length;
      const progressPerSegment = 70 / totalSegments;

      for (let i = 0; i < segmentUrls.length; i++) {
        if (job.cancelled) return;

        const segmentUrl = segmentUrls[i];
        const segmentResponse = await fetch(segmentUrl, {
          headers: job.headers || {}
        });
        
        if (!segmentResponse.ok) {
          throw new Error(`Failed to download segment ${i + 1}: ${segmentResponse.statusText}`);
        }

        const segmentBuffer = await segmentResponse.arrayBuffer();
        const segmentPath = join(tempDir, `${job.jobId}_segment_${i}.ts`);
        await writeFile(segmentPath, Buffer.from(segmentBuffer));
        segmentFiles.push(segmentPath);
        tempFilesToCleanup.push(segmentPath);

        const progress = 25 + (i + 1) * progressPerSegment;
        this.updateProgress(job.jobId, progress);
      }

      if (job.cancelled) return;

      this.updateProgress(job.jobId, 95);

      const outputPath = join(tempDir, `${job.jobId}_${job.filename.replace(/\.m3u8$/, '.mp4')}`);
      const outputStream = createWriteStream(outputPath);

      for (const segmentFile of segmentFiles) {
        if (job.cancelled) {
          outputStream.close();
          return;
        }

        const segmentStream = createReadStream(segmentFile);
        await pipeline(segmentStream, outputStream, { end: false });
        await unlink(segmentFile).catch(() => {});
        const index = tempFilesToCleanup.indexOf(segmentFile);
        if (index > -1) {
          tempFilesToCleanup.splice(index, 1);
        }
      }

      outputStream.end();
      this.updateProgress(job.jobId, 100);

    } catch (error) {
      const outputPath = join(tempDir, `${job.jobId}_${job.filename.replace(/\.m3u8$/, '.mp4')}`);
      segmentFiles.push(outputPath);
      await this.cleanupTempFiles(segmentFiles);
      throw error;
    }
  }

  private async cleanupTempFiles(files: string[]): Promise<void> {
    const { unlink } = await import('fs/promises');
    const { existsSync } = await import('fs');
    
    for (const file of files) {
      try {
        if (existsSync(file)) {
          await unlink(file);
        }
      } catch (error) {
        console.error(`Failed to cleanup temp file ${file}:`, error);
      }
    }
  }

  /**
   * Get download file path
   */
  async getDownloadPath(jobId: string): Promise<string | null> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'completed') {
      return null;
    }

    const { join } = await import('path');
    const { existsSync } = await import('fs');
    const tempDir = join(process.cwd(), 'temp', 'downloads');
    
    // Try to find the file
    const possibleNames = [
      `${jobId}_${job.filename}`,
      `${jobId}_${job.filename.replace(/\.m3u8$/, '.mp4')}`
    ];

    for (const name of possibleNames) {
      const filePath = join(tempDir, name);
      if (existsSync(filePath)) {
        return filePath;
      }
    }

    return null;
  }

  /**
   * Cleanup old jobs (older than 1 hour)
   */
  cleanupOldJobs(): void {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const [jobId, job] of this.jobs.entries()) {
      if (job.completedAt && job.completedAt < oneHourAgo) {
        this.jobs.delete(jobId);
        this.progressCallbacks.delete(jobId);
      }
    }
  }

  /**
   * Cleanup temp directory files
   */
  async cleanupTempDirectory(): Promise<void> {
    const { join } = await import('path');
    const { readdir, unlink, stat, rmdir } = await import('fs/promises');
    const { existsSync } = await import('fs');
    
    const tempDir = join(process.cwd(), 'temp');
    if (!existsSync(tempDir)) {
      return;
    }

    try {
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      const entries = await readdir(tempDir, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = join(tempDir, entry.name);
        try {
          if (entry.isFile()) {
            const stats = await stat(entryPath);
            if (stats.mtimeMs < twoHoursAgo) {
              await unlink(entryPath);
              console.log(`[Cleanup] Deleted old temp file: ${entryPath}`);
            }
          } else if (entry.isDirectory()) {
            const subEntries = await readdir(entryPath, { withFileTypes: true });
            let deletedCount = 0;
            
            for (const subEntry of subEntries) {
              const subEntryPath = join(entryPath, subEntry.name);
              try {
                if (subEntry.isFile()) {
                  const stats = await stat(subEntryPath);
                  if (stats.mtimeMs < twoHoursAgo) {
                    await unlink(subEntryPath);
                    deletedCount++;
                    console.log(`[Cleanup] Deleted old temp file: ${subEntryPath}`);
                  }
                } else if (subEntry.isDirectory()) {
                  const deepEntries = await readdir(subEntryPath, { withFileTypes: true });
                  for (const deepEntry of deepEntries) {
                    const deepEntryPath = join(subEntryPath, deepEntry.name);
                    try {
                      if (deepEntry.isFile()) {
                        const stats = await stat(deepEntryPath);
                        if (stats.mtimeMs < twoHoursAgo) {
                          await unlink(deepEntryPath);
                          deletedCount++;
                          console.log(`[Cleanup] Deleted old temp file: ${deepEntryPath}`);
                        }
                      }
                    } catch (error) {
                      console.error(`[Cleanup] Failed to delete ${deepEntryPath}:`, error);
                    }
                  }
                }
              } catch (error) {
                console.error(`[Cleanup] Failed to process ${subEntryPath}:`, error);
              }
            }
            
            if (deletedCount > 0) {
              const remainingEntries = await readdir(entryPath, { withFileTypes: true });
              if (remainingEntries.length === 0) {
                try {
                  await rmdir(entryPath);
                  console.log(`[Cleanup] Removed empty directory: ${entryPath}`);
                } catch (error) {
                  console.error(`[Cleanup] Failed to remove empty directory ${entryPath}:`, error);
                }
              }
            }
          }
        } catch (error) {
          console.error(`[Cleanup] Failed to process ${entryPath}:`, error);
        }
      }
      
      const remainingEntries = await readdir(tempDir, { withFileTypes: true });
      if (remainingEntries.length === 0) {
        try {
          await rmdir(tempDir);
          console.log(`[Cleanup] Removed empty temp directory: ${tempDir}`);
        } catch (error) {
          console.error(`[Cleanup] Failed to remove empty temp directory:`, error);
        }
      }
    } catch (error) {
      console.error(`[Cleanup] Failed to cleanup temp directory:`, error);
    }
  }
}

// Singleton instance
export const downloadQueue = new DownloadQueue();

// Cleanup old jobs every 30 minutes
setInterval(() => {
  downloadQueue.cleanupOldJobs();
}, 30 * 60 * 1000);

// Cleanup temp directory every 2 hours
setInterval(() => {
  downloadQueue.cleanupTempDirectory().catch((error) => {
    console.error('[Cleanup] Scheduled temp cleanup failed:', error);
  });
}, 2 * 60 * 60 * 1000);

