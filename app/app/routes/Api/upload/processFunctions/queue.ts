import { Queue } from 'bullmq';

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
}

export class UploadQueue {
  private queue: Queue<UploadJobData>;

  constructor() {
    this.queue = new Queue<UploadJobData>('upload-processing');
    
    this.queue.on('error', (error) => {
      console.error('Upload queue error:', error);
    });
  }

  async addJob(data: UploadJobData): Promise<string> {
    const job = await this.queue.add('process-upload', data, {
      jobId: data.uniqueID,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: {
        age: 3600,
        count: 1000,
      },
      removeOnFail: {
        age: 86400,
      },
    });
    return job.id!;
  }

  async getJobStatus(jobId: string) {
    try {
      const job = await this.queue.getJob(jobId);
      if (!job) {
        return null;
      }

      const state = await job.getState();
      const progress = job.progress;
      const result = await job.returnvalue;

      return {
        id: job.id,
        state,
        progress,
        result,
        failedReason: job.failedReason,
      };
    } catch (error) {
      console.error('Failed to get job status:', error);
      return null;
    }
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export const uploadQueue = new UploadQueue();
