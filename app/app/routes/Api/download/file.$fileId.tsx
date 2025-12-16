import { data } from "react-router";
import { downloadQueue } from "~/lib/Services/DownloadQueue";

export const loader = async ({ params }: { params: { fileId: string } }) => {
  try {
    const jobId = params.fileId;
    const job = downloadQueue.getJobStatus(jobId);
    
    if (!job || job.status !== 'completed') {
      return data({ error: "Download not ready" }, { status: 404 });
    }

    const filePath = await downloadQueue.getDownloadPath(jobId);
    if (!filePath) {
      return data({ error: "File not found" }, { status: 404 });
    }

    const { readFile } = await import('fs/promises');
    const { basename } = await import('path');
    const fileBuffer = await readFile(filePath);
    const filename = basename(filePath).replace(/^\w+_/, '');

    return new Response(fileBuffer, {
      headers: {
        'Content-Type': job.fileType === 'image' ? 'image/jpeg' : 'video/mp4',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': fileBuffer.length.toString()
      }
    });
  } catch (error) {
    console.error("Error in download file loader:", error);
    return data({ error: "Internal server error" }, { status: 500 });
  }
};

