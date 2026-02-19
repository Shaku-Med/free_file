import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import { downloadQueue } from "~/lib/Services/DownloadQueue";
import { checkFileAccess } from "~/routes/Dynamic/fun/accessControl";
import db from "~/lib/Database/supabase";
import { randomUUID } from "crypto";
import { BASE_URL } from "~/lib/URLS";
import { isValidUUID } from "~/lib/Security/inputValidation";

export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== "POST") {
      return data({ error: "Method not allowed" }, { status: 405 });
    }

    const user = await isAuthenticated(request, ['id']);
    if (!user || !user.id) {
      return data({ error: "Unauthorized" }, { status: 401 });
    }

    if (!db) {
      return data({ error: "Database not initialized" }, { status: 500 });
    }

    const body = await request.json();
    const { fileId } = body;

    if (!fileId || !isValidUUID(fileId)) {
      return data({ error: "Invalid fileId format" }, { status: 400 });
    }

    // Fetch file data
    const { data: file, error: fileError } = await db
      .from('files')
      .select('*')
      .eq('id', fileId)
      .maybeSingle();

    if (fileError || !file) {
      return data({ error: "File not found" }, { status: 404 });
    }

    // Check access control
    const accessControl = await checkFileAccess(request, file);
    if (!accessControl.allowed) {
      return data({ error: "Access denied" }, { status: 403 });
    }

    // Determine file type and URL
    const isHLS = file.file_type === 'application/vnd.apple.mpegurl' || file.endpoint?.includes('.m3u8');
    const isImage = file.file_type?.startsWith('image/');
    const isVideo = file.file_type?.includes('video/') || isHLS;

    if (!isImage && !isVideo) {
      return data({ error: "Unsupported file type" }, { status: 400 });
    }

    // Build download URL (absolute URL) using BASE_URL
    const baseUrl = BASE_URL;

    let downloadUrl: string;
    if (isImage) {
      downloadUrl = `${baseUrl}/api/load/image/${file.endpoint}`;
    } else {
      const owner = process.env.GITHUB_OWNER || "";
      downloadUrl = `https://github.com/${owner}/Memories/raw/main/${file.endpoint}`;
    }

    // Generate filename
    const filename = file.file_title && file.file_title.trim() !== ''
      ? `${file.file_title}${isImage ? '.jpg' : isHLS ? '.mp4' : '.mp4'}`
      : file.filename;

    // Create download job
    const jobId = randomUUID();
    try {
      // Get auth cookies/headers for the download
      const cookies = request.headers.get('cookie') || '';
      const sessionId = request.headers.get('x-session-id') || '';
      
      downloadQueue.addJob({
        jobId,
        fileId: file.id,
        fileType: isImage ? 'image' : 'video',
        fileUrl: downloadUrl,
        filename,
        userId: user.id,
        headers: {
          'Cookie': cookies,
          'x-session-id': sessionId
        } as any
      });

      return data({ 
        success: true, 
        jobId,
        status: 'pending'
      }, { status: 200 });
    } catch (error) {
      console.error("Error in download action:", error);
      return data({ 
        error: "Failed to queue download" 
      }, { status: 500 });
    }
  } catch (error) {
    console.error("Error in download action:", error);
    return data({ error: "Internal server error" }, { status: 500 });
  }
};


