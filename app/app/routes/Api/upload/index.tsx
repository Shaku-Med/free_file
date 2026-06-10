/**
 * =============================================================================
 * ⚠️  AI AGENTS / MAINTAINERS — READ BEFORE EDITING
 * =============================================================================
 *
 * THIS FILE IS **LEGACY**. DO NOT re-enable browser uploads here and DO NOT
 * wire new upload flows to POST /api/upload.
 *
 * **All user file uploads go through GoUpload** (`free_file/GoUpload`), NOT
 * this Remix app. The app only:
 *   - Proxies auth (`/api/upload/auth`)
 *   - Checks users for GoUpload (`/api/upload-server-check`)
 *   - Receives webhooks (`/api/upload-job-status`)
 *
 * Client upload UI lives in:
 *   - `app/routes/Home/components/MediaSelectionModal.tsx`  → GoUpload chunked API
 *   - `app/lib/uploadAuth.client.ts`                        → auth + health check
 *
 * This route is kept **intentionally** for possible future server-to-server use
 * (VIDEO_TOKEN / server-to-server-token only). Browser requests get 403.
 *
 * To change upload behavior, edit **GoUpload** — not this file.
 * =============================================================================
 */

import { VerifyToken } from '~/lib/Security/unsharedkeyEncryption/Combined/Verification/VerifyToken';
import { uploadQueue } from './processFunctions/queue';
import { getCookie } from '~/lib/Security/Token';
import { initializeWorker } from './processFunctions/worker';
import { isAuthenticated } from '~/lib/Security/Password';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import * as crypto from 'crypto';
import { chunkFile } from './processFunctions/chunking';
import type { ChunkInfo } from './processFunctions/chunking';
import db from '~/lib/Database/supabase';
import { MAX_UPLOAD_FILE_BYTES, MAX_UPLOAD_LABEL } from '~/lib/uploadLimits';
import { reserveUploadQuota, refundUploadQuota } from '~/lib/uploadQuota.server';
import { logError } from '~/lib/Logging/errorLog.server';

if (typeof process !== 'undefined') {
  try {
    initializeWorker();
  } catch {
    console.warn('Upload worker initialization failed.');
  }
}


const VerifyB4Uploading = async (headers: Headers) => {
  try {
    let keys = ['session_id']

    let token = getCookie('sessionId', headers)
    if(!token) return null
    let decoded = await VerifyToken({
      token: token,
      addedKeyNames: keys || []
    }, headers)
    if(!decoded) return null
    let sessionIdHex = typeof decoded.sessionID === 'string' ? decoded.sessionID : ''
    let providedHex = headers.get('x-session-id') || ''
    const isHex = (s: string) => /^[0-9a-f]+$/i.test(s)
    if(!isHex(sessionIdHex)) return null
    if(providedHex){
      if(!isHex(providedHex)) return null
      const a = Buffer.from(sessionIdHex.toLowerCase(), 'hex')
      const b = Buffer.from(providedHex.toLowerCase(), 'hex')
      if(a.length !== b.length) return null
      if(!crypto.timingSafeEqual(a, b)) return null
    }
    return true
  }
  catch {
    return null
  }
}


const serverToServerUpload = async (request: Request): Promise<boolean> => {
  try {
    const expected = process.env.VIDEO_TOKEN
    if(!expected) return false
    let authorization = request.headers.get('server-to-server-token')
    if(!authorization) return false
    authorization = authorization.split(' ')[1]
    if(!authorization) return false
    // Constant-time compare so the secret can't be recovered by timing.
    const a = Buffer.from(authorization)
    const b = Buffer.from(expected)
    if(a.length !== b.length) return false
    if(!crypto.timingSafeEqual(a, b)) return false
    return true 
  }
  catch {
    return false
  }
}

export const action = async ({ request }: { request: Request }) => {
  // Tracked so we can refund the weekly-quota reservation if anything after
  // reserving fails before the job is safely queued.
  let quotaUploadId = '';
  try {

    const serverToServer = await serverToServerUpload(request)
    // Browser uploads must go through GoUpload (chunked). This endpoint is
    // server-to-server only (legacy worker / internal hooks). See file header.
    if (!serverToServer) {
      return new Response(
        JSON.stringify({
          error: 'Direct app uploads are disabled. Start the Go upload server and upload through it.',
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const uniqueID = formData.get('uniqueID') as string;
    const title = formData.get('title') as string | null;
    const description = formData.get('description') as string | null;
    const isPublicValue = formData.get('isPublic') as string | null;
    const isPublic = isPublicValue === null ? true : isPublicValue === 'true' || isPublicValue === '1';
    
    if (!file || !uniqueID || !title) {
      return new Response(JSON.stringify({ error: 'Invalid request' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      return new Response(
        JSON.stringify({ error: `File size exceeds maximum limit of ${MAX_UPLOAD_LABEL}` }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(uniqueID)) {
      return new Response(JSON.stringify({ error: 'Invalid uniqueID format' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (title.length > 200) {
      return new Response(JSON.stringify({ error: 'Title must be 200 characters or less' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (description && description.length > 5000) {
      return new Response(JSON.stringify({ error: 'Description must be 5000 characters or less' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const fileName = file.name.toLowerCase();
    const validImageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
    const validVideoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m3u8', '.m4v', '.3gp', '.mpeg', '.mpg', '.wmv', '.flv', '.ts', '.m2ts', '.mts'];
    
    const extensionIndex = fileName.lastIndexOf('.');
    const fileExtension = extensionIndex >= 0 ? fileName.substring(extensionIndex) : '';
    const isTypeImage = file.type.startsWith('image/');
    const isTypeVideo = file.type.startsWith('video/');
    const isExtensionImage = validImageExtensions.includes(fileExtension);
    const isExtensionVideo = validVideoExtensions.includes(fileExtension);
    const isImage = isTypeImage || (!isTypeVideo && isExtensionImage);
    const isVideo = isTypeVideo || (!isTypeImage && isExtensionVideo);

    if (!isImage && !isVideo) {
      return new Response(JSON.stringify({ error: 'Unsupported file type. Only images and videos are allowed.' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!isExtensionImage && !isExtensionVideo) {
      return new Response(JSON.stringify({ error: 'Unsupported file extension' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const tempDir = join(process.cwd(), 'upload', 'temp');
    if (!existsSync(tempDir)) {
      await mkdir(tempDir, { recursive: true });
    }

    const user = await isAuthenticated(request, ['id']);
    
    if (!serverToServer && (!user || typeof user === 'boolean' || !user.id)) {
      return new Response(JSON.stringify({ error: 'Authentication required to upload files' }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const ownerId = serverToServer 
      ? (process.env.DEFAULT_ID || '')
      : (user && typeof user !== 'boolean' && user.id ? user.id : process.env.DEFAULT_ID);

    if (!ownerId) {
      return new Response(JSON.stringify({ error: 'Invalid owner ID' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Weekly upload quota: reserve before doing any heavy work. Skipped for
    // trusted server-to-server uploads. Refunded later on queue failure.
    if (!serverToServer) {
      const reservation = await reserveUploadQuota(ownerId, uniqueID, file.size);
      if (!reservation.ok) {
        if (reservation.reason === 'limit') {
          return new Response(
            JSON.stringify({ error: 'Weekly upload limit reached. Please try again later.' }),
            { status: 429, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({ error: 'Something went wrong! Please try again later.' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
      quotaUploadId = uniqueID;
    }

    try {
      if (db) {
        // IDOR guard: unique_id is client-supplied. Reject if it already
        // belongs to someone else so an attacker can't hijack/overwrite
        // another user's file row by reusing their unique_id.
        const { data: existing } = await db
          .from('files')
          .select('owner_id')
          .eq('unique_id', uniqueID)
          .maybeSingle();
        if (existing && (existing as { owner_id?: string }).owner_id && (existing as { owner_id?: string }).owner_id !== ownerId) {
          if (quotaUploadId) {
            await refundUploadQuota(quotaUploadId);
            quotaUploadId = '';
          }
          return new Response(
            JSON.stringify({ error: 'This upload identifier is already in use.' }),
            { status: 409, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const insertData: Record<string, any> = {
          created_at: new Date().toISOString(),
          endpoint: '',
          filename: file.name,
          unique_id: uniqueID,
          file_type: file.type,
          file_size: file.size.toString(),
          owner_id: ownerId,
          file_title: title,
          file_description: description || null,
          is_public: isPublic,
          upload_status: 'queued',
          processing_progress: 0,
        };

        await db
          .from('files')
          .upsert(insertData, {
            onConflict: 'unique_id',
            ignoreDuplicates: false
          });
      }
    } catch (error) {
      console.warn('Failed to create queued upload record:', error);
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const chunkResult = await chunkFile(fileBuffer, uniqueID, tempDir);
    
    let filePath: string;
    let chunks: ChunkInfo[] | undefined;

    if (chunkResult.isChunked && chunkResult.chunks.length > 0) {
      chunks = chunkResult.chunks;
      filePath = join(tempDir, `upload_${uniqueID}_${randomUUID()}_chunked`);
    } else {
      filePath = join(tempDir, `upload_${uniqueID}_${randomUUID()}`);
      await writeFile(filePath, fileBuffer);
    }

    const jobPayload = {
      file: {
        filePath: filePath,
        originalName: file.name,
        mimeType: file.type,
        size: file.size
      },
      uniqueID,
      title,
      description: description || undefined,
      ownerId,
      chunks: chunks,
      isPublic
    };

    const jobId = await uploadQueue.addJob(jobPayload as any);

    if (!jobId) {
      if (quotaUploadId) {
        await refundUploadQuota(quotaUploadId);
        quotaUploadId = '';
      }
      if (db) {
        try {
          await db
            .from('files')
            .delete()
            .eq('unique_id', uniqueID)
            .eq('owner_id', ownerId);
        } catch (error) {
          console.warn('Failed to cleanup queued upload record:', error);
        }
      }
      if (chunks) {
        for (const chunk of chunks) {
          await unlink(chunk.filePath).catch(() => {});
        }
      } else {
        await unlink(filePath).catch(() => {});
      }
      return new Response(JSON.stringify({ error: 'Failed to queue upload' }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      jobId
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    if (quotaUploadId) {
      await refundUploadQuota(quotaUploadId);
    }
    const ref = await logError({ error, source: 'api/upload', request, status: 500 });
    return new Response(JSON.stringify({ error: 'Upload failed', ref }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}