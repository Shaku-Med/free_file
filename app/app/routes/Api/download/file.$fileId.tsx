import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import { downloadQueue } from "~/lib/Services/DownloadQueue";
import { refuseIfDownloadsDisabled } from "~/lib/Security/downloadPolicy.server";

export const loader = async ({ request, params }: { request: Request; params: { fileId: string } }) => {
  // Sealed with the rest of the download surface. This is the route that
  // actually streams bytes off disk, so it refuses before touching the fs.
  const refused = refuseIfDownloadsDisabled();
  if (refused) return refused;

  const { readFile, unlink } = await import('fs/promises');
  const { basename } = await import('path');
  let filePath: string | null = null;

  try {
    const user = await isAuthenticated(request, ['id']);
    if (!user?.id) {
      return data({ error: "Unauthorized" }, { status: 401 });
    }

    const jobId = params.fileId;
    const job = downloadQueue.getJobStatus(jobId);
    if (!job || job.status !== 'completed') {
      return data({ error: "Download not ready" }, { status: 404 });
    }
    if (job.userId && job.userId !== user.id) {
      return data({ error: "Forbidden" }, { status: 403 });
    }

    filePath = await downloadQueue.getDownloadPath(jobId);
    if (!filePath) {
      return data({ error: "File not found" }, { status: 404 });
    }

    const fileBuffer = await readFile(filePath);
    const filename = basename(filePath).replace(/^\w+_/, '');

    setTimeout(async () => {
      try {
        if (filePath) {
          await unlink(filePath).catch(() => {});
        }
      } catch (error) {
        console.error("Error cleaning up download file:", error);
      }
    }, 1000);

    return new Response(fileBuffer, {
      headers: {
        'Content-Type': job.fileType === 'image' ? 'image/jpeg' : 'video/mp4',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': fileBuffer.length.toString()
      }
    });
  } catch (error) {
    if (filePath) {
      await unlink(filePath).catch(() => {});
    }
    console.error("Error in download file loader:", error);
    return data({ error: "Internal server error" }, { status: 500 });
  }
};

