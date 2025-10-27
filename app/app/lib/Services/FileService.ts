import { FileUploader } from '../Github/FileUploader';
import db from '../Database/supabase';

export interface FileUploadData {
  file: File;
  uniqueID: string;
  filename: string;
}

export interface FileRecord {
  id?: string;
  created_at: string;
  endpoint: string;
  filename: string;
  unique_id: string;
  file_type: string;
  file_size: number;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  fileType?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface UploadServiceResult {
  success: boolean;
  githubPath?: string;
  supabaseId?: string;
  error?: string;
}

export class FileService {
  private fileUploader: FileUploader;

  constructor(
    githubToken: string,
    githubOwner: string
  ) {
    this.fileUploader = new FileUploader(githubToken, githubOwner);
  }

  async initialize(): Promise<void> {
    await this.fileUploader.initializeRepository();
  }

  async uploadFile(fileData: FileUploadData): Promise<UploadServiceResult> {
    try {
      const githubResult = await this.fileUploader.uploadFile(
        fileData.file,
        fileData.uniqueID,
        fileData.filename
      );

      if (!githubResult.success) {
        return {
          success: false,
          error: githubResult.error
        };
      }

      const shouldStoreInSupabase = 
        (fileData.file.type === 'application/vnd.apple.mpegurl' || 
         fileData.file.type.startsWith('image/')) &&
        !fileData.filename.startsWith('thumbnail_');

      let supabaseId: string | undefined;

      if (shouldStoreInSupabase) {
        if (!db) {
          throw new Error('Database not initialized');
        }

        const { data, error } = await db
          .from('files')
          .insert([{
            created_at: new Date().toISOString(),
            endpoint: githubResult.filePath!,
            filename: fileData.filename,
            unique_id: fileData.uniqueID,
            file_type: fileData.file.type,
            file_size: fileData.file.size
          }])
          .select()
          .single();

        if (error) {
          console.error('Database insert error:', error);
          throw new Error('Failed to insert file');
        }

        supabaseId = data.id;
      }
      
      return {
        success: true,
        githubPath: githubResult.filePath,
        supabaseId: supabaseId
      };
    } catch (error) {
      console.error('Error in file service:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async uploadMultipleFiles(files: FileUploadData[]): Promise<UploadServiceResult[]> {
    const results: UploadServiceResult[] = [];
    
    for (const fileData of files) {
      const result = await this.uploadFile(fileData);
      results.push(result);
    }
    
    return results;
  }

  async getFileByUniqueID(uniqueID: string): Promise<FileRecord | null> {
    if (!db) {
      throw new Error('Database not initialized');
    }

    const { data, error } = await db
      .from('files')
      .select('*')
      .eq('unique_id', uniqueID)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Database get file error:', error);
      throw new Error('Failed to get file');
    }

    return data;
  }

  async getAllFiles(): Promise<FileRecord[]> {
    if (!db) {
      throw new Error('Database not initialized');
    }

    const { data, error } = await db
      .from('files')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Database get all files error:', error);
      throw new Error('Failed to get files');
    }

    return data || [];
  }

  async getFilesByType(fileType: string): Promise<FileRecord[]> {
    if (!db) {
      throw new Error('Database not initialized');
    }

    const { data, error } = await db
      .from('files')
      .select('*')
      .like('file_type', `${fileType}%`)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Database get files by type error:', error);
      throw new Error('Failed to get files by type');
    }

    return data || [];
  }

  async getFilesPaginated(params: PaginationParams = {}): Promise<PaginatedResponse<FileRecord>> {
    try {
      if (!db) {
        throw new Error('Database not initialized');
      }
  
      const {
        page = 1,
        limit = 10,
        sortBy = 'created_at',
        sortOrder = 'desc',
        fileType
      } = params;
  
      const offset = (page - 1) * limit;
  
      let query = db
        .from('files')
        .select('*', { count: 'exact' });
  
      if (fileType) {
        query = query.like('file_type', `${fileType}%`);
      }
  
      const { data, error, count } = await query
        .order(sortBy, { ascending: sortOrder === 'asc' })
        .range(offset, offset + limit - 1);
  
      if (error) {
        console.error('Database get paginated files error:', error);
        throw new Error('Failed to get paginated files');
      }
  
      const total = count || 0;
      const totalPages = Math.ceil(total / limit);
  
      return {
        data: data || [],
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      };

    }
    catch (error) {
      return {
        data: [],
        pagination: {
          page: 1,
          limit: 50,
          total: 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: false
        }
      };
    }
  }

  async getFilesByTypePaginated(fileType: string, params: PaginationParams = {}): Promise<PaginatedResponse<FileRecord>> {
    return this.getFilesPaginated({ ...params, fileType });
  }

}
