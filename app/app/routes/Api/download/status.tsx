import { data } from "react-router";
import { downloadQueue } from "~/lib/Services/DownloadQueue";

export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    const jobId = url.searchParams.get('jobId');
    
    if (!jobId) {
      return data({ error: "jobId is required" }, { status: 400 });
    }

    const job = downloadQueue.getJobStatus(jobId);
    if (!job) {
      return data({ error: "Job not found" }, { status: 404 });
    }

    return data({
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      error: job.error,
      downloadUrl: job.downloadUrl
    }, { status: 200 });
  } catch (error) {
    console.error("Error in download status loader:", error);
    return data({ error: "Internal server error" }, { status: 500 });
  }
};

