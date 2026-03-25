import type { ChunkInfo } from './chunking.js';
import { getUploadWorker, type UploadJobHandle } from './worker';

export interface UploadJobData {
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

type JobState = 'waiting' | 'active' | 'completed' | 'failed';

type JobRecord = {
  state: JobState;
  progress: number | object;
  result?: unknown;
  failedReason?: string;
};

const jobs = new Map<string, JobRecord>();

function createJobHandle(data: UploadJobData, jobId: string): UploadJobHandle {
  return {
    id: jobId,
    data,
    opts: { attempts: 3 },
    attemptsMade: 0,
    async updateProgress(n: number | object) {
      const p = typeof n === 'number' ? n : 0;
      const rec = jobs.get(jobId);
      if (rec) {
        rec.progress = p;
        if (rec.state === 'waiting') {
          rec.state = 'active';
        }
      }
    },
  };
}

export class UploadQueue {
  async addJob(data: UploadJobData): Promise<string> {
    const jobId = data.uniqueID;
    jobs.set(jobId, { state: 'waiting', progress: 0 });

    const worker = getUploadWorker();
    const handle = createJobHandle(data, jobId);

    void (async () => {
      const rec = jobs.get(jobId);
      if (rec) {
        rec.state = 'active';
      }
      try {
        const result = await worker.processUpload(handle);
        jobs.set(jobId, {
          state: 'completed',
          progress: 100,
          result,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload processing failed';
        const prev = jobs.get(jobId);
        jobs.set(jobId, {
          state: 'failed',
          progress: prev?.progress ?? 0,
          failedReason: msg,
        });
      }
    })();

    return jobId;
  }

  async getJobStatus(jobId: string) {
    try {
      const rec = jobs.get(jobId);
      if (!rec) {
        return null;
      }

      return {
        id: jobId,
        state: rec.state,
        progress: rec.progress,
        result: rec.state === 'completed' ? rec.result : undefined,
        failedReason: rec.failedReason,
      };
    } catch (error) {
      console.error('Failed to get job status:', error);
      return null;
    }
  }

  async close(): Promise<void> {
    // In-process queue: nothing to close
  }
}

export const uploadQueue = new UploadQueue();
