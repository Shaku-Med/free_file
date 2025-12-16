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
        pendingJob.error = error instanceof Error ? error.message : 'Unknown error';
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
    const { mkdir, writeFile, unlink } = await import('fs/promises');
    const { existsSync } = await import('fs');
    const { createWriteStream } = await import('fs');

    try {
      // Check if cancelled
      if (job.cancelled) {
        job.status = 'cancelled';
        return;
      }

      const tempDir = join(process.cwd(), 'temp', 'downloads');
      if (!existsSync(tempDir)) {
        await mkdir(tempDir, { recursive: true });
      }

      this.updateProgress(job.jobId, 10);

      if (job.fileType === 'image') {
        // Download image
        await this.downloadImage(job, tempDir);
      } else if (job.fileType === 'video') {
        // Download HLS video (all segments)
        await this.downloadHLSVideo(job, tempDir);
      }

      // Check if cancelled before completing
      if (job.cancelled) {
        job.status = 'cancelled';
        // Cleanup
        const outputPath = join(tempDir, `${job.jobId}_${job.filename}`);
        if (existsSync(outputPath)) {
          await unlink(outputPath).catch(() => {});
        }
        return;
      }

      job.status = 'completed';
      job.progress = 100;
      job.completedAt = Date.now();
      job.downloadUrl = `/api/download/file/${job.jobId}`;

    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Download job ${job.jobId} failed:`, error);
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
  private async downloadHLSVideo(job: DownloadJob, tempDir: string): Promise<void> {
    const { join } = await import('path');
    const { writeFile, unlink } = await import('fs/promises');
    const { existsSync } = await import('fs');
    const { createWriteStream } = await import('fs');
    const { createReadStream } = await import('fs');
    const { pipeline } = await import('stream/promises');
    const { Readable } = await import('stream');

    try {
      this.updateProgress(job.jobId, 15);

      // Fetch m3u8 manifest
      const manifestResponse = await fetch(job.fileUrl, {
        headers: job.headers || {}
      });
      if (!manifestResponse.ok) {
        throw new Error(`Failed to fetch HLS manifest: ${manifestResponse.statusText}`);
      }

      const manifestText = await manifestResponse.text();
      if (job.cancelled) return;

      // Parse manifest to get segment URLs
      const manifestBaseUrl = new URL(job.fileUrl);
      const manifestDir = manifestBaseUrl.pathname.substring(0, manifestBaseUrl.pathname.lastIndexOf('/') + 1);
      const segmentUrls: string[] = [];
      const lines = manifestText.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !line.startsWith('#')) {
          if (line.startsWith('http://') || line.startsWith('https://')) {
            // Absolute URL
            segmentUrls.push(line);
          } else {
            // Relative URL - construct absolute URL
            const segmentUrl = new URL(line, `${manifestBaseUrl.origin}${manifestDir}`).href;
            segmentUrls.push(segmentUrl);
          }
        }
      }

      if (segmentUrls.length === 0) {
        throw new Error('No segments found in HLS manifest');
      }

      this.updateProgress(job.jobId, 25);

      // Download all segments
      const segmentFiles: string[] = [];
      const totalSegments = segmentUrls.length;
      const progressPerSegment = 70 / totalSegments; // 70% for downloading segments

      for (let i = 0; i < segmentUrls.length; i++) {
        if (job.cancelled) {
          // Cleanup downloaded segments
          for (const segFile of segmentFiles) {
            if (existsSync(segFile)) {
              await unlink(segFile).catch(() => {});
            }
          }
          return;
        }

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

        const progress = 25 + (i + 1) * progressPerSegment;
        this.updateProgress(job.jobId, progress);
      }

      if (job.cancelled) {
        // Cleanup
        for (const segFile of segmentFiles) {
          if (existsSync(segFile)) {
            await unlink(segFile).catch(() => {});
          }
        }
        return;
      }

      this.updateProgress(job.jobId, 95);

      // Merge segments into single file
      const outputPath = join(tempDir, `${job.jobId}_${job.filename.replace(/\.m3u8$/, '.mp4')}`);
      const outputStream = createWriteStream(outputPath);

      for (const segmentFile of segmentFiles) {
        if (job.cancelled) {
          outputStream.close();
          if (existsSync(outputPath)) {
            await unlink(outputPath).catch(() => {});
          }
          // Cleanup segments
          for (const segFile of segmentFiles) {
            if (existsSync(segFile)) {
              await unlink(segFile).catch(() => {});
            }
          }
          return;
        }

        const segmentStream = createReadStream(segmentFile);
        await pipeline(segmentStream, outputStream, { end: false });
        await unlink(segmentFile).catch(() => {});
      }

      outputStream.end();
      this.updateProgress(job.jobId, 100);

    } catch (error) {
      throw error;
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
}

// Singleton instance
export const downloadQueue = new DownloadQueue();

// Cleanup old jobs every 30 minutes
setInterval(() => {
  downloadQueue.cleanupOldJobs();
}, 30 * 60 * 1000);

