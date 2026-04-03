import { stripGithubRepoForClient } from "~/lib/githubStorage";
import db from "~/lib/Database/supabase";
import type { FileType } from "~/lib/types";
import { filterFilesByAccess } from "~/routes/Api/fun/accessControl";
import { ownerService } from "~/lib/Services/OwnerService";

export const getRandomVideos = async (
  request: Request,
  excludeId: string,
  currentFile?: FileType | null,
  limit: number = 20
): Promise<FileType[]> => {
  try {
    if (!db) {
      return [];
    }

    const baseQuery = db
      .from('files')
      .select('*')
      .neq('unique_id', excludeId)
      .eq('is_public', true);

    let query = baseQuery;

    if (currentFile?.file_type) {
      const fileTypePrefix = currentFile.file_type.split('/')[0];
      query = query.ilike('file_type', `%${fileTypePrefix}%`);
    }

    const { data: relatedFiles, error: relatedError } = await query
      .order('up_count', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit * 2);

    let suggestions: FileType[] = [];

    if (relatedFiles && relatedFiles.length > 0) {
      suggestions = relatedFiles.map((r: Record<string, unknown>) =>
        stripGithubRepoForClient(r),
      ) as FileType[];
    }

    if (suggestions.length < limit) {
      const { data: fallbackFiles, error: fallbackError } = await baseQuery
        .order('created_at', { ascending: false })
        .limit((limit - suggestions.length) * 2);

      if (fallbackFiles) {
        const fallback = fallbackFiles
          .filter((file: FileType) => !suggestions.some(s => s.id === file.id))
          .map((r: Record<string, unknown>) => stripGithubRepoForClient(r)) as FileType[];
        suggestions = [...suggestions, ...fallback];
      }
    }

    const filteredFiles = await filterFilesByAccess(request, suggestions);
    
    // Enrich files with owner data
    const filesWithOwners = await ownerService.enrichFilesWithOwners(filteredFiles);
    
    const shuffled = [...filesWithOwners].sort(() => Math.random() - 0.5);
    
    return shuffled.slice(0, limit) as FileType[];
  } catch (error) {
    console.error('Error fetching random videos:', error);
    return [];
  }
};

