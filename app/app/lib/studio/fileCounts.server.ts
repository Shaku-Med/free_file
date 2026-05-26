import db from "~/lib/Database/supabase";

// Batch counts likes and comments per file id and returns totals.
// Single source of truth so the schema assumption lives in one place.

export interface FileCounts {
  likes: Map<string, number>;
  comments: Map<string, number>;
  totalLikes: number;
  totalComments: number;
}

// Supabase URL header cap is ~16KB. A uuid is 36 chars + 3 for ",%22%22"
// after URL encoding, so we keep chunks well below that.
const CHUNK = 100;

async function countByFile(table: "likes" | "comments", fileIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!db || fileIds.length === 0) return counts;

  for (let i = 0; i < fileIds.length; i += CHUNK) {
    const slice = fileIds.slice(i, i + CHUNK);
    const { data, error } = await db.from(table).select("file_id").in("file_id", slice);
    if (error) {
      console.error(`[fileCounts] ${table}`, error);
      continue;
    }
    for (const row of (data ?? []) as Array<{ file_id: string }>) {
      counts.set(row.file_id, (counts.get(row.file_id) ?? 0) + 1);
    }
  }
  return counts;
}

export async function getFileCounts(fileIds: string[]): Promise<FileCounts> {
  const empty: FileCounts = {
    likes: new Map(),
    comments: new Map(),
    totalLikes: 0,
    totalComments: 0,
  };
  if (!db || fileIds.length === 0) return empty;

  const [likes, comments] = await Promise.all([
    countByFile("likes", fileIds),
    countByFile("comments", fileIds),
  ]);

  let totalLikes = 0;
  for (const v of likes.values()) totalLikes += v;
  let totalComments = 0;
  for (const v of comments.values()) totalComments += v;

  return { likes, comments, totalLikes, totalComments };
}
