import { writeFile, readFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const CHUNK_SIZE = 60 * 1024 * 1024;

export interface ChunkInfo {
  chunkIndex: number;
  totalChunks: number;
  chunkId: string;
  filePath: string;
  size: number;
}

export async function chunkFile(
  fileBuffer: Buffer,
  uniqueID: string,
  tempDir: string
): Promise<{ chunks: ChunkInfo[]; isChunked: boolean }> {
  if (fileBuffer.length <= CHUNK_SIZE) {
    return { chunks: [], isChunked: false };
  }

  if (!existsSync(tempDir)) {
    await mkdir(tempDir, { recursive: true });
  }

  const totalChunks = Math.ceil(fileBuffer.length / CHUNK_SIZE);
  const chunks: ChunkInfo[] = [];
  const chunkId = randomUUID();

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, fileBuffer.length);
    const chunkBuffer = fileBuffer.slice(start, end);
    
    const chunkPath = join(tempDir, `chunk_${uniqueID}_${chunkId}_${i}`);
    await writeFile(chunkPath, chunkBuffer);
    
    chunks.push({
      chunkIndex: i,
      totalChunks,
      chunkId,
      filePath: chunkPath,
      size: chunkBuffer.length
    });
  }

  return { chunks, isChunked: true };
}

export async function reassembleChunks(
  chunks: ChunkInfo[],
  outputPath: string
): Promise<void> {
  if (chunks.length === 0) {
    throw new Error('No chunks to reassemble');
  }

  chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
  
  const buffers: Buffer[] = [];
  for (const chunk of chunks) {
    const buffer = await readFile(chunk.filePath);
    buffers.push(buffer);
  }

  const fullBuffer = Buffer.concat(buffers);
  await writeFile(outputPath, fullBuffer);

  for (const chunk of chunks) {
    try {
      if (existsSync(chunk.filePath)) {
        await unlink(chunk.filePath);
      }
    } catch {}
  }
}

export async function uploadChunks(
  chunks: ChunkInfo[],
  uniqueID: string,
  title: string,
  description: string | undefined,
  ownerId: string,
  mimeType: string,
  originalName: string,
  uploadFunction: (chunk: ChunkInfo) => Promise<{ success: boolean; error?: string }>
): Promise<{ success: boolean; error?: string }> {
  const chunkMetadata = {
    uniqueID,
    title,
    description,
    ownerId,
    mimeType,
    originalName,
    totalChunks: chunks.length,
    chunkId: chunks[0]?.chunkId
  };

  const metadataPath = join(process.cwd(), 'upload', 'temp', `metadata_${uniqueID}_${chunks[0]?.chunkId}.json`);
  await writeFile(metadataPath, JSON.stringify(chunkMetadata));

  for (let i = 0; i < chunks.length; i++) {
    const result = await uploadFunction(chunks[i]);
    if (!result.success) {
      return { success: false, error: `Chunk ${i} upload failed: ${result.error}` };
    }
  }

  try {
    if (existsSync(metadataPath)) {
      await unlink(metadataPath);
    }
  } catch {}

  return { success: true };
}
