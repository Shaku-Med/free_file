import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import { downloadQueue } from "~/lib/Services/DownloadQueue";
import { refuseIfDownloadsDisabled } from "~/lib/Security/downloadPolicy.server";

export const action = async ({ request }: { request: Request }) => {
  const refused = refuseIfDownloadsDisabled();
  if (refused) return refused;

  try {
    if (request.method !== "POST") {
      return data({ error: "Method not allowed" }, { status: 405 });
    }

    const user = await isAuthenticated(request, ['id']);
    if (!user || !user.id) {
      return data({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { jobId } = body;

    if (!jobId) {
      return data({ error: "jobId is required" }, { status: 400 });
    }

    const job = downloadQueue.getJobStatus(jobId);
    if (!job) {
      return data({ error: "Job not found" }, { status: 404 });
    }

    if (job.userId !== user.id) {
      return data({ error: "Unauthorized" }, { status: 403 });
    }

    const cancelled = downloadQueue.cancelJob(jobId);
    return data({ success: cancelled }, { status: 200 });
  } catch (error) {
    console.error("Error in download cancel action:", error);
    return data({ error: "Internal server error" }, { status: 500 });
  }
};

