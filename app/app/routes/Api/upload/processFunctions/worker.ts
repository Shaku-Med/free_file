import { Worker, Job } from 'bullmq';
import { FileService } from '~/lib/Services/FileService';
import { NSFWDetectionService } from './NSFWDetectionService';
import { VideoThumbnailService } from './VideoThumbnailService';
import { processVideoToHLS } from './videoProcessor';
import { config } from '~/lib/config';
import { writeFile, unlink, readFile, readdir, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, extname } from 'path';
import { randomUUID } from 'crypto';
import db from '~/lib/Database/supabase';
import { reassembleChunks } from './chunking.js';
import type { ChunkInfo } from './chunking.js';

interface UploadJobData {
  file: {
    filePath: string;
    originalName: string;
    mimeType: string;
    size: number;
  };
  uniqueID: string;
  title: string;
  description?: string;
  ownerId?: string;
  chunks?: ChunkInfo[];
  isPublic?: boolean;
}

interface ProcessResult {
  success: boolean;
  isAdult?: boolean;
  thumbnails?: { buffer: Buffer; timeOffset: number }[];
  error?: string;
}

export class UploadWorker {
  private worker: Worker<UploadJobData, ProcessResult> | null = null;
  private fileService: FileService;
  private nsfwService: NSFWDetectionService;
  private thumbnailService: VideoThumbnailService;
  private initialized: boolean = false;

  constructor() {
    this.fileService = new FileService(
      config.github.token,
      config.github.owner
    );

    this.nsfwService = new NSFWDetectionService();
    this.thumbnailService = new VideoThumbnailService();
  }

  initializeWorker(): boolean {
    if (this.initialized && this.worker) {
      return true;
    }

    try {
      this.worker = new Worker<UploadJobData, ProcessResult>(
        'upload-processing',
        async (job: Job<UploadJobData>) => {
          return await this.processUpload(job);
        },
        {
          connection: {},
          concurrency: 1,
          limiter: {
            max: 5,
            duration: 1000,
          },
        }
      );

      this.setupEventHandlers();
      this.initialized = true;
      return true;
    } catch (error) {
      console.warn('Upload worker initialization skipped. Redis connection required for queue processing.');
      console.warn('Start Redis with: docker compose up -d (in free_file/app directory)');
      this.worker = null;
      this.initialized = false;
      return false;
    }
  }

  getWorker(): Worker<UploadJobData, ProcessResult> | null {
    if (!this.initialized) {
      this.initializeWorker();
    }
    return this.worker;
  }

  async processUpload(job: Job<UploadJobData>): Promise<ProcessResult> {
    const tempDir = join(process.cwd(), 'upload', 'temp');
    let tempFilesToCleanup: string[] = [];

    try {
      console.log(`[Upload Worker] Starting job ${job.id} for uniqueID: ${job.data.uniqueID}`);
      await job.updateProgress(10);
      await this.fileService.initialize();

      const { file, uniqueID, title, description, ownerId, chunks, isPublic } = job.data;
      await this.updateUploadStatus(uniqueID, 'processing', isPublic);
      
      let fileBuffer: Buffer;
      let actualFilePath: string;

      if (chunks && chunks.length > 0) {
        actualFilePath = join(tempDir, `reassembled_${uniqueID}_${randomUUID()}`);
        await reassembleChunks(chunks, actualFilePath);
        fileBuffer = await readFile(actualFilePath);
        tempFilesToCleanup.push(actualFilePath);
        for (const chunk of chunks) {
          tempFilesToCleanup.push(chunk.filePath);
        }
      } else {
        if (!existsSync(file.filePath)) {
          await this.updateUploadStatus(uniqueID, 'failed', isPublic);
          await this.deleteUploadRecord(uniqueID);
          return {
            success: false,
            error: 'File not found at specified path'
          };
        }
        actualFilePath = file.filePath;
        fileBuffer = await readFile(file.filePath);
        tempFilesToCleanup.push(file.filePath);
      }
      
      const isImage = this.isImageFile(file.mimeType, file.originalName);
      const isVideo = this.isVideoFile(file.mimeType, file.originalName);

      if (!isImage && !isVideo) {
        await this.updateUploadStatus(uniqueID, 'failed', isPublic);
        await this.deleteUploadRecord(uniqueID);
        return {
          success: false,
          error: 'Unsupported file type. Only images and videos are allowed.'
        };
      }

      let isAdult: boolean | undefined = undefined;
      let videoThumbnails: { buffer: Buffer; timeOffset: number }[] | undefined = undefined;
      let durationSeconds: number | undefined = undefined;

      if (isImage) {
        await job.updateProgress(30);
        isAdult = await this.nsfwService.detectNSFW(fileBuffer, file.mimeType);
        await job.updateProgress(50);
      }

      if (isVideo) {
        await job.updateProgress(30);
        const thumbnailResult = await this.thumbnailService.extractThumbnails(fileBuffer, 10);
        
        if (thumbnailResult.success && thumbnailResult.thumbnails) {
          videoThumbnails = thumbnailResult.thumbnails;
          if (typeof thumbnailResult.duration === 'number' && Number.isFinite(thumbnailResult.duration) && thumbnailResult.duration > 0) {
            durationSeconds = Math.round(thumbnailResult.duration);
          }
          await job.updateProgress(45);
          
          isAdult = false;
          for (const thumbnail of videoThumbnails) {
            const isThumbnailNSFW = await this.nsfwService.detectNSFW(
              thumbnail.buffer,
              'image/jpeg'
            );
            
            if (isThumbnailNSFW) {
              isAdult = true;
              break;
            }
          }
          await job.updateProgress(50);
        } else {
          isAdult = false;
        }
      }

      await job.updateProgress(60);

      if (!existsSync(tempDir)) {
        await mkdir(tempDir, { recursive: true });
      }

      if (isImage) {
        const mimeTypeExtension = this.getMimeTypeExtension(file.mimeType);
        const filename = `${uniqueID}.${mimeTypeExtension}`;

        const fileBlob = new Blob([new Uint8Array(fileBuffer)], { type: file.mimeType });
        const uploadFile = new File([fileBlob], filename, { type: file.mimeType });

        const uploadResult = await this.fileService.uploadFile({
          file: uploadFile,
          uniqueID,
          filename,
          isAdult,
          title,
          description,
          ownerId,
          isPublic,
          uploadStatus: 'completed'
        });

        await job.updateProgress(90);

        if (!uploadResult.success) {
          console.error(`[Upload Worker] Image upload failed for ${uniqueID}:`, uploadResult.error);
          await this.updateUploadStatus(uniqueID, 'failed', isPublic);
          await this.deleteUploadRecord(uniqueID);
          await this.cleanupTempFiles(tempFilesToCleanup);
          return {
            success: false,
            error: uploadResult.error || 'Upload failed'
          };
        }

        console.log(`[Upload Worker] Image uploaded successfully for ${uniqueID}. GitHub: ${uploadResult.githubPath}, Supabase ID: ${uploadResult.supabaseId}`);
        
        await this.cleanupTempFiles(tempFilesToCleanup);
      }

      if (isVideo) {
        await job.updateProgress(65);

        const inputExtension = this.getInputExtension(file.originalName, file.mimeType);
        const inputPath = join(tempDir, `input_${uniqueID}_${randomUUID()}${inputExtension}`);
        const outputPath = join(tempDir, `output_${uniqueID}_${randomUUID()}.m3u8`);
        
        tempFilesToCleanup.push(inputPath);
        await writeFile(inputPath, fileBuffer);

        const hlsResult = await processVideoToHLS(inputPath, outputPath, 'medium');

        if (!hlsResult.success) {
          await this.updateUploadStatus(uniqueID, 'failed', isPublic);
          await this.deleteUploadRecord(uniqueID);
          await this.cleanupTempFiles(tempFilesToCleanup);
          return {
            success: false,
            error: hlsResult.error || 'HLS conversion failed'
          };
        }

        tempFilesToCleanup.push(outputPath);
        if (hlsResult.segmentFiles) {
          tempFilesToCleanup.push(...hlsResult.segmentFiles);
        }

        await job.updateProgress(75);

        const m3u8Content = await readFile(outputPath, 'utf-8');
        const m3u8Blob = new Blob([m3u8Content], { type: 'application/vnd.apple.mpegurl' });
        const m3u8File = new File([m3u8Blob], `${uniqueID}.m3u8`, { type: 'application/vnd.apple.mpegurl' });

        const safeDurationSeconds = typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0
          ? Math.min(durationSeconds, 24 * 60 * 60)
          : undefined;
        const isReel = typeof safeDurationSeconds === 'number' && safeDurationSeconds > 0 && safeDurationSeconds <= 60;

        const m3u8UploadResult = await this.fileService.uploadFile({
          file: m3u8File,
          uniqueID,
          filename: `${uniqueID}.m3u8`,
          isAdult,
          title,
          description,
          ownerId,
          durationSeconds: safeDurationSeconds,
          isReel,
          isPublic,
          uploadStatus: 'completed'
        });

        if (!m3u8UploadResult.success) {
          console.error(`[Upload Worker] M3U8 upload failed for ${uniqueID}:`, m3u8UploadResult.error);
          await this.updateUploadStatus(uniqueID, 'failed', isPublic);
          await this.deleteUploadRecord(uniqueID);
          await this.cleanupTempFiles(tempFilesToCleanup);
          return {
            success: false,
            error: m3u8UploadResult.error || 'M3U8 upload failed'
          };
        }

        console.log(`[Upload Worker] M3U8 uploaded successfully for ${uniqueID}. GitHub: ${m3u8UploadResult.githubPath}, Supabase ID: ${m3u8UploadResult.supabaseId}`);

        await job.updateProgress(80);

        if (hlsResult.segmentFiles && hlsResult.segmentFiles.length > 0) {
          for (let i = 0; i < hlsResult.segmentFiles.length; i++) {
            const segmentPath = hlsResult.segmentFiles[i];
            const segmentData = await readFile(segmentPath);
            const segmentBlob = new Blob([new Uint8Array(segmentData)], { type: 'video/mp2t' });
            const segmentName = segmentPath.split(/[/\\]/).pop() || `segment_${i}.ts`;
            const segmentFile = new File([segmentBlob], segmentName, { type: 'video/mp2t' });

            await this.fileService.uploadFile({
              file: segmentFile,
              uniqueID,
              filename: segmentName,
              isAdult: undefined,
              title: undefined,
              description: undefined,
              ownerId
            });
          }
        }

        await job.updateProgress(90);

        const thumbnailEndpoints: string[] = [];

        if (videoThumbnails) {
          const dateFolder = this.getDateFolder();
          
          for (let i = 0; i < videoThumbnails.length; i++) {
            const thumbnail = videoThumbnails[i];
            const thumbnailFilename = `${uniqueID}_thumb_${i + 1}.jpg`;
            const thumbnailBlob = new Blob([new Uint8Array(thumbnail.buffer)], { type: 'image/jpeg' });
            const thumbnailFile = new File([thumbnailBlob], thumbnailFilename, { type: 'image/jpeg' });

            const thumbnailUploadResult = await this.fileService.uploadFile({
              file: thumbnailFile,
              uniqueID,
              filename: thumbnailFilename,
              isAdult: false,
              title: undefined,
              description: undefined,
              ownerId
            });

            if (thumbnailUploadResult.success && thumbnailUploadResult.githubPath) {
              thumbnailEndpoints.push(thumbnailUploadResult.githubPath);
            }
          }

          if (thumbnailEndpoints.length > 0 && db) {
            try {
              const { error: updateError } = await db
                .from('files')
                .update({ thumbnails: thumbnailEndpoints })
                .eq('unique_id', uniqueID);
              
              if (updateError) {
                console.error(`[Upload Worker] Failed to update thumbnails for ${uniqueID}:`, updateError);
              } else {
                console.log(`[Upload Worker] Updated thumbnails for ${uniqueID}: ${thumbnailEndpoints.length} thumbnails`);
              }
            } catch (error) {
              console.error(`[Upload Worker] Failed to update thumbnails for ${uniqueID}:`, error);
            }
          }
        }

        await this.updateUploadStatus(uniqueID, 'completed', isPublic);
        await this.cleanupTempFiles(tempFilesToCleanup);
      }

      await job.updateProgress(100);

      console.log(`[Upload Worker] Job ${job.id} completed successfully for ${job.data.uniqueID}`);
      return {
        success: true,
        isAdult
      };
    } catch (error) {
      console.error(`[Upload Worker] Job ${job.id} failed for ${job.data.uniqueID}:`, error);
      await this.updateUploadStatus(job.data.uniqueID, 'failed', job.data.isPublic);
      await this.deleteUploadRecord(job.data.uniqueID);
      await this.cleanupTempFiles(tempFilesToCleanup);
      return {
        success: false,
        error: 'Upload processing failed'
      };
    }
  }

  private async deleteUploadRecord(uniqueID: string): Promise<void> {
    try {
      if (!db) {
        return;
      }
      await db
        .from('files')
        .delete()
        .eq('unique_id', uniqueID);
    } catch (error) {
      console.warn(`[Upload Worker] Failed to delete record for ${uniqueID}:`, error);
    }
  }

  private async updateUploadStatus(uniqueID: string, status: string, isPublic?: boolean): Promise<void> {
    try {
      if (!db) {
        return;
      }
      const updateData: Record<string, any> = { upload_status: status };
      if (typeof isPublic === 'boolean') {
        updateData.is_public = isPublic;
      }
      await db
        .from('files')
        .update(updateData)
        .eq('unique_id', uniqueID);
    } catch (error) {
      console.warn(`[Upload Worker] Failed to update status for ${uniqueID}:`, error);
    }
  }

  private async cleanupTempFiles(files: string[]): Promise<void> {
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

  private getDateFolder(): string {
    const now = new Date();
    const day = now.getDate().toString().padStart(2, '0');
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear();
    return `${day}_${month}_${year}`;
  }

  private isImageFile(mimeType: string, originalName: string): boolean {
    if (mimeType.startsWith('image/')) {
      return true;
    }
    const extension = extname(originalName || '').toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'].includes(extension);
  }

  private isVideoFile(mimeType: string, originalName: string): boolean {
    if (mimeType.startsWith('video/')) {
      return true;
    }
    const extension = extname(originalName || '').toLowerCase();
    return ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m3u8', '.m4v', '.3gp', '.mpeg', '.mpg', '.wmv', '.flv', '.ts', '.m2ts', '.mts'].includes(extension);
  }

  private getInputExtension(originalName: string, mimeType: string): string {
    const extension = extname(originalName || '').toLowerCase();
    if (extension) {
      return extension;
    }
    const fallback = this.getMimeTypeExtension(mimeType);
    return `.${fallback}`;
  }

  private getMimeTypeExtension(mimeType: string): string {
    const mimeMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'video/mp4': 'mp4',
      'video/m4v': 'm4v',
      'video/3gpp': '3gp',
      'video/mpeg': 'mpeg',
      'video/x-msvideo': 'avi',
      'video/x-matroska': 'mkv',
      'video/webm': 'webm',
      'video/quicktime': 'mov',
      'video/x-ms-wmv': 'wmv',
      'video/x-flv': 'flv',
      'video/mp2t': 'ts',
      'application/vnd.apple.mpegurl': 'm3u8',
    };

    return mimeMap[mimeType.toLowerCase()] || 'bin';
  }

  private setupEventHandlers(): void {
    if (!this.worker) return;

    this.worker.on('completed', (job) => {
      console.log(`Upload job ${job.id} completed`);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`Upload job ${job?.id} failed:`, err);
    });

    this.worker.on('error', (err) => {
      console.error('Upload worker error:', err);
    });

    this.worker.on('closing', () => {
      console.log('Upload worker is closing...');
    });
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }
}

let uploadWorkerInstance: UploadWorker | null = null;

export function getUploadWorker(): UploadWorker {
  if (!uploadWorkerInstance) {
    uploadWorkerInstance = new UploadWorker();
  }
  return uploadWorkerInstance;
}

export function initializeWorker(): boolean {
  try {
    const worker = getUploadWorker();
    return worker.initializeWorker();
  } catch (error) {
    console.warn('Upload worker initialization skipped. Redis connection required for queue processing.');
    return false;
  }
}
